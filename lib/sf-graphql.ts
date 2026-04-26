// Thin Salesforce REST GraphQL client.
//
// Why GraphQL (not Apex REST, not REST /query):
//   - GraphQL enforces FLS + sharing for ALL users, including admins with
//     "View All Data". Plain REST /query enforces FLS only for non-admins.
//   - Mutations within a single request execute in a single transaction —
//     all-or-nothing rollback on error. Equivalent to Apex DML transactions
//     without writing Apex.
//   - Pure TypeScript. No SFDX project, no Apex test-coverage chore, no
//     code deploy on the customer's SF org. Customer admins only need to
//     create the custom objects + fields (see docs/SALESFORCE_SETUP.md).
//
// Endpoint: /services/data/vXX.X/graphql
// Docs:    https://developer.salesforce.com/docs/platform/graphql

import { type SfAuth, TCUnauthorizedError } from "./sf-auth";

const SF_API_VERSION = process.env.SF_API_VERSION ?? "v62.0";

interface GraphQLError {
  message: string;
  errorType?: string;
  extensions?: Record<string, unknown>;
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: GraphQLError[];
}

export async function sfGraphQL<T>(
  auth: SfAuth,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(
    `${auth.instanceUrl}/services/data/${SF_API_VERSION}/graphql`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${auth.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables: variables ?? {} }),
      cache: "no-store",
    },
  );

  if (res.status === 401 || res.status === 403) {
    throw new TCUnauthorizedError(
      "Salesforce rejected the request (token or permission issue).",
    );
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `Salesforce GraphQL ${res.status} ${res.statusText}: ${body.slice(0, 500)}`,
    );
  }

  const json = (await res.json()) as GraphQLResponse<T>;

  if (json.errors && json.errors.length > 0) {
    // GraphQL request-level errors (auth, parse, validation) come back as
    // 200 with `errors`. Field-level errors live inside data.<field>.errors
    // on the UI API mutation result and are surfaced by the callers.
    throw new Error(
      `Salesforce GraphQL error: ${json.errors.map((e) => e.message).join("; ")}`,
    );
  }

  if (!json.data) {
    throw new Error("Salesforce GraphQL: empty data");
  }
  return json.data;
}

/**
 * Helper: extract a scalar field value from the SF GraphQL UI API shape.
 *   { Name: { value: "Acme" } }  -> "Acme"
 */
export function val<T = string>(
  field: { value: T } | null | undefined,
): T | null {
  return field?.value ?? null;
}
