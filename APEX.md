# Salesforce Apex REST setup

The MCP server's Salesforce mode (`USE_SALESFORCE=true`) expects these
Apex REST endpoints to exist in your Salesforce org. Every SOQL query
uses `WITH USER_MODE` so FLS and sharing are enforced even for admin
users.

Paste the classes below into Setup → Apex Classes → New.

## 1. DTOs + shared helpers

```apex
public class TCDto {
    public class OpportunityDto {
        public String id;
        public String name;
        public String stage;
        public Decimal amount;
        public OpportunityDto(Opportunity o) {
            this.id = o.Id;
            this.name = o.Name;
            this.stage = o.StageName;
            this.amount = o.Amount == null ? 0 : o.Amount;
        }
    }
    public class ContactDto {
        public String id;
        public String opportunityId;
        public String name;
        public String title;
        public ContactDto(OpportunityContactRole r) {
            this.id = r.Contact.Id;
            this.opportunityId = r.OpportunityId;
            this.name = r.Contact.Name;
            this.title = r.Contact.Title == null ? '' : r.Contact.Title;
        }
    }
    public class VoiceDto {
        public String id;
        public String name;
        public String gender;
        public String description;
    }
    public class ScenarioDto {
        public String id;
        public String name;
        public String description;
    }
    public class CreateSessionInput {
        public String opportunityId;
        public String contactId;
        public String voiceId;
        public String scenarioId;
        public String backstory;
    }
    public class RoleplaySessionDto {
        public String id;
        public String url;
        public String createdAt;
        public Map<String, Object> dealContext;
    }
}
```

## 2. `GET /services/apexrest/tc/opportunities`

```apex
@RestResource(urlMapping='/tc/opportunities')
global with sharing class TCOpportunitiesApi {
    @HttpGet
    global static List<TCDto.OpportunityDto> list() {
        List<Opportunity> rows = [
            SELECT Id, Name, StageName, Amount
            FROM Opportunity
            WHERE IsClosed = false
            WITH USER_MODE
            ORDER BY CloseDate NULLS LAST
            LIMIT 50
        ];
        List<TCDto.OpportunityDto> out = new List<TCDto.OpportunityDto>();
        for (Opportunity o : rows) out.add(new TCDto.OpportunityDto(o));
        return out;
    }
}
```

## 3. `GET /services/apexrest/tc/opportunities/{id}/contacts`

```apex
@RestResource(urlMapping='/tc/opportunities/*/contacts')
global with sharing class TCOpportunityContactsApi {
    @HttpGet
    global static List<TCDto.ContactDto> list() {
        // urlMapping path is /tc/opportunities/{id}/contacts
        String uri = RestContext.request.requestURI;
        List<String> parts = uri.split('/');
        // parts: ['', 'services', 'apexrest', 'tc', 'opportunities', '<id>', 'contacts']
        String oppId = parts.size() >= 7 ? parts[5] : null;
        if (String.isBlank(oppId) || !Pattern.matches('[a-zA-Z0-9]{15,18}', oppId)) {
            RestContext.response.statusCode = 400;
            return new List<TCDto.ContactDto>();
        }
        List<OpportunityContactRole> rows = [
            SELECT Id, OpportunityId, Contact.Id, Contact.Name, Contact.Title
            FROM OpportunityContactRole
            WHERE OpportunityId = :oppId
            WITH USER_MODE
            LIMIT 50
        ];
        List<TCDto.ContactDto> out = new List<TCDto.ContactDto>();
        for (OpportunityContactRole r : rows) out.add(new TCDto.ContactDto(r));
        return out;
    }
}
```

## 4. `GET /services/apexrest/tc/voices` and `/tc/scenarios`

Voices and scenarios are product metadata. Two options:

**Option A — custom metadata types (recommended).** Create
`TC_Voice__mdt` and `TC_Scenario__mdt` with fields for `Name`,
`Gender__c`, `Description__c`. Then:

```apex
@RestResource(urlMapping='/tc/voices')
global with sharing class TCVoicesApi {
    @HttpGet
    global static List<TCDto.VoiceDto> list() {
        List<TC_Voice__mdt> rows = [
            SELECT Id, DeveloperName, MasterLabel, Gender__c, Description__c
            FROM TC_Voice__mdt
            WITH USER_MODE
            ORDER BY MasterLabel
        ];
        List<TCDto.VoiceDto> out = new List<TCDto.VoiceDto>();
        for (TC_Voice__mdt v : rows) {
            TCDto.VoiceDto d = new TCDto.VoiceDto();
            d.id = v.DeveloperName;
            d.name = v.MasterLabel;
            d.gender = v.Gender__c;
            d.description = v.Description__c;
            out.add(d);
        }
        return out;
    }
}
```

Scenarios is the same pattern.

**Option B — hard-coded in Apex.** Return a static list. Simpler, but
adding a voice requires a code deploy.

## 5. `POST /services/apexrest/tc/sessions`

This one is external-system-ish: it writes a Tough Customer session
record (via your HTTP callout to `https://www.toughcustomer.ai/api/…`)
and returns the resulting URL. The Apex class exists mostly to keep
the SF session context + let you log the session back to the
Opportunity timeline.

```apex
@RestResource(urlMapping='/tc/sessions')
global with sharing class TCSessionsApi {
    @HttpPost
    global static TCDto.RoleplaySessionDto create(TCDto.CreateSessionInput input) {
        // 1. Validate user has access to the opportunity + contact
        //    via USER_MODE sanity selects.
        List<Opportunity> opp = [
            SELECT Id, Name, StageName, Amount
            FROM Opportunity WHERE Id = :input.opportunityId
            WITH USER_MODE LIMIT 1
        ];
        if (opp.isEmpty()) {
            RestContext.response.statusCode = 404;
            return null;
        }

        // 2. POST to Tough Customer API with a Named Credential.
        //    Add a Named Credential `ToughCustomerAPI` pointing at
        //    https://www.toughcustomer.ai with appropriate auth.
        HttpRequest req = new HttpRequest();
        req.setEndpoint('callout:ToughCustomerAPI/api/sessions');
        req.setMethod('POST');
        req.setHeader('Content-Type', 'application/json');
        req.setBody(JSON.serialize(input));
        HttpResponse res = new Http().send(req);
        if (res.getStatusCode() >= 300) {
            RestContext.response.statusCode = res.getStatusCode();
            return null;
        }

        // 3. Parse, optionally log a Task on the Opportunity,
        //    and return. Parsing/shape is up to your API.
        Map<String, Object> parsed = (Map<String, Object>) JSON.deserializeUntyped(res.getBody());
        TCDto.RoleplaySessionDto out = new TCDto.RoleplaySessionDto();
        out.id = (String) parsed.get('id');
        out.url = (String) parsed.get('url');
        out.createdAt = (String) parsed.get('createdAt');
        out.dealContext = (Map<String, Object>) parsed.get('dealContext');
        return out;
    }
}
```

## 6. Connected App for OAuth

Setup → App Manager → New Connected App:

- API (Enable OAuth Settings)
- Callback URL: whatever Claude gives you on connector setup.
  Today that's typically `https://claude.ai/api/mcp/auth_callback`
  (verify in Claude's docs — this evolves).
- Selected Scopes: `api`, `refresh_token`, `openid`
- **Require Proof Key for Code Exchange (PKCE)** — ON (required by MCP).
- **Enable Client Credentials Flow** — OFF.
- **Require Secret for Web Server Flow** — OFF (MCP clients are public
  clients; PKCE is the protection).

After save, note the Consumer Key. If your SF edition supports
**Dynamic Client Registration** (Spring '25+), enable it so Claude can
self-register instead of you hand-provisioning the callback.

## 7. Permissions

Give the profiles/permission sets that will use the MCP server
`Apex Class Access` on all five `TC*Api` classes. FLS + sharing on
`Opportunity` and `OpportunityContactRole` is what actually controls
what each user sees — the Apex classes just expose it.

## 8. Wiring it up in the MCP server

```bash
vercel env add USE_SALESFORCE production   # value: true
vercel env add SF_LOGIN_URL production     # value: https://<mydomain>.my.salesforce.com
vercel env add SF_API_VERSION production   # value: v62.0 (optional; defaults to v62.0)
vercel env add MCP_PUBLIC_URL production   # value: https://mcp-umber-three.vercel.app
```

For sandboxes use `https://test.salesforce.com` or your sandbox My
Domain. Redeploy after setting env vars.
