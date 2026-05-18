export type GoogleActivityItem = {
  actor?: {
    email?: string;
  };
  events?: GoogleActivityEvent[];
  id?: {
    applicationName?: string;
    time?: string;
    uniqueQualifier?: string;
  };
};

export type GoogleActivityEvent = {
  name?: string;
  parameters?: GoogleActivityParameter[];
  type?: string;
};

export type GoogleActivityParameter = {
  boolValue?: boolean;
  intValue?: string | number;
  multiValue?: string[];
  name?: string;
  value?: string;
};

export type NormalizedOAuthEvent = {
  appName: string | null;
  eventName: string;
  eventTime: string;
  googleEventId: string;
  oauthClientId: string | null;
  rawJson: GoogleActivityItem;
  scopes: string[];
  userEmail: string | null;
};

export type NormalizedSamlEvent = {
  eventName: string;
  eventTime: string;
  googleEventId: string;
  rawJson: GoogleActivityItem;
  samlAppName: string | null;
  success: boolean | null;
  userEmail: string | null;
};

export type NormalizedLoginEvent = {
  eventName: string;
  eventTime: string;
  googleEventId: string;
  loginType: string | null;
  rawJson: GoogleActivityItem;
  userEmail: string | null;
};

export type GoogleUsageReport = {
  date?: string;
  parameters?: GoogleUsageParameter[];
};

export type GoogleUsageParameter = {
  intValue?: string | number;
  messageValue?: GoogleUsageMessage;
  multiMessageValue?: GoogleUsageMessage[];
  name?: string;
  value?: string;
};

export type GoogleUsageMessage = {
  parameter?: GoogleUsageParameter[];
};

export type NormalizedAuthorizedApp = {
  appName: string;
  rawJson: GoogleUsageReport;
  reportDate: string;
  usersCount: number;
};

export function normalizeOAuthActivity(
  item: GoogleActivityItem,
): NormalizedOAuthEvent[] {
  return normalizeActivityEvents(item).map(({ event, eventIndex }) => {
    const params = getParameterMap(event.parameters ?? []);

    return {
      appName: firstStringParameter(params, [
        "app_name",
        "application_name",
        "client_name",
        "display_name",
      ]),
      eventName: event.name ?? "unknown",
      eventTime: item.id?.time ?? new Date().toISOString(),
      googleEventId: buildGoogleEventId(item, event, eventIndex),
      oauthClientId: firstStringParameter(params, ["client_id", "client"]),
      rawJson: item,
      scopes: firstStringListParameter(params, ["scope", "scopes"]),
      userEmail: item.actor?.email ?? null,
    };
  });
}

export function normalizeSamlActivity(
  item: GoogleActivityItem,
): NormalizedSamlEvent[] {
  return normalizeActivityEvents(item).map(({ event, eventIndex }) => {
    const params = getParameterMap(event.parameters ?? []);

    return {
      eventName: event.name ?? "unknown",
      eventTime: item.id?.time ?? new Date().toISOString(),
      googleEventId: buildGoogleEventId(item, event, eventIndex),
      rawJson: item,
      samlAppName: firstStringParameter(params, [
        "app_name",
        "application_name",
        "saml_app_name",
        "service_provider",
      ]),
      success: inferSuccess(event, params),
      userEmail: item.actor?.email ?? null,
    };
  });
}

export function normalizeLoginActivity(
  item: GoogleActivityItem,
): NormalizedLoginEvent[] {
  return normalizeActivityEvents(item).map(({ event, eventIndex }) => {
    const params = getParameterMap(event.parameters ?? []);

    return {
      eventName: event.name ?? "unknown",
      eventTime: item.id?.time ?? new Date().toISOString(),
      googleEventId: buildGoogleEventId(item, event, eventIndex),
      loginType: firstStringParameter(params, ["login_type", "type"]),
      rawJson: item,
      userEmail: item.actor?.email ?? null,
    };
  });
}

export function normalizeAuthorizedAppsReport(
  report: GoogleUsageReport,
): NormalizedAuthorizedApp[] {
  const reportDate = report.date ?? new Date().toISOString().slice(0, 10);
  const authorizedApps = (report.parameters ?? []).filter(
    (parameter) => parameter.name === "accounts:authorized_apps",
  );

  return authorizedApps.flatMap((parameter) =>
    extractAuthorizedAppMessages(parameter).flatMap((message) => {
      const params = getUsageParameterMap(message.parameter ?? []);
      const appName = firstUsageStringParameter(params, [
        "app_name",
        "application_name",
        "client_name",
        "name",
      ]);

      if (!appName) {
        return [];
      }

      return [
        {
          appName,
          rawJson: report,
          reportDate,
          usersCount:
            firstUsageIntegerParameter(params, [
              "num_users",
              "users_count",
              "count",
            ]) ?? 0,
        },
      ];
    }),
  );
}

function normalizeActivityEvents(item: GoogleActivityItem): Array<{
  event: GoogleActivityEvent;
  eventIndex: number;
}> {
  const events = item.events ?? [];

  if (events.length === 0) {
    return [{ event: { name: item.id?.applicationName ?? "unknown" }, eventIndex: 0 }];
  }

  return events.map((event, eventIndex) => ({ event, eventIndex }));
}

function buildGoogleEventId(
  item: GoogleActivityItem,
  event: GoogleActivityEvent,
  eventIndex: number,
): string {
  return [
    item.id?.applicationName ?? "unknown",
    item.id?.uniqueQualifier ?? item.id?.time ?? "unknown",
    event.name ?? "unknown",
    eventIndex,
  ].join(":");
}

function getParameterMap(
  parameters: GoogleActivityParameter[],
): Map<string, GoogleActivityParameter> {
  return new Map(
    parameters.flatMap((parameter) =>
      parameter.name ? [[parameter.name.toLowerCase(), parameter]] : [],
    ),
  );
}

function firstStringParameter(
  params: Map<string, GoogleActivityParameter>,
  names: string[],
): string | null {
  for (const name of names) {
    const value = params.get(name.toLowerCase());
    const stringValue = value?.value ?? value?.intValue;

    if (typeof stringValue === "string" && stringValue.trim()) {
      return stringValue.trim();
    }

    if (typeof stringValue === "number") {
      return String(stringValue);
    }
  }

  return null;
}

function firstStringListParameter(
  params: Map<string, GoogleActivityParameter>,
  names: string[],
): string[] {
  for (const name of names) {
    const value = params.get(name.toLowerCase());

    if (Array.isArray(value?.multiValue)) {
      return value.multiValue.filter((item) => item.trim().length > 0);
    }

    if (typeof value?.value === "string" && value.value.trim()) {
      return value.value
        .split(/[,\s]+/)
        .map((scope) => scope.trim())
        .filter(Boolean);
    }
  }

  return [];
}

function inferSuccess(
  event: GoogleActivityEvent,
  params: Map<string, GoogleActivityParameter>,
): boolean | null {
  const status = firstStringParameter(params, [
    "login_result",
    "status",
    "result",
    "success",
  ])?.toLowerCase();

  if (status) {
    if (["success", "successful", "true", "succeeded"].includes(status)) {
      return true;
    }

    if (["failure", "failed", "false", "denied"].includes(status)) {
      return false;
    }
  }

  const eventName = event.name?.toLowerCase() ?? "";

  if (eventName.includes("success")) {
    return true;
  }

  if (eventName.includes("fail")) {
    return false;
  }

  return null;
}

function extractAuthorizedAppMessages(
  parameter: GoogleUsageParameter,
): GoogleUsageMessage[] {
  if (Array.isArray(parameter.multiMessageValue)) {
    return parameter.multiMessageValue;
  }

  if (parameter.messageValue) {
    return [parameter.messageValue];
  }

  return [];
}

function getUsageParameterMap(
  parameters: GoogleUsageParameter[],
): Map<string, GoogleUsageParameter> {
  return new Map(
    parameters.flatMap((parameter) =>
      parameter.name ? [[parameter.name.toLowerCase(), parameter]] : [],
    ),
  );
}

function firstUsageStringParameter(
  params: Map<string, GoogleUsageParameter>,
  names: string[],
): string | null {
  for (const name of names) {
    const value = params.get(name.toLowerCase())?.value;

    if (value?.trim()) {
      return value.trim();
    }
  }

  return null;
}

function firstUsageIntegerParameter(
  params: Map<string, GoogleUsageParameter>,
  names: string[],
): number | null {
  for (const name of names) {
    const parameter = params.get(name.toLowerCase());
    const value = parameter?.intValue ?? parameter?.value;
    const parsedValue =
      typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);

    if (Number.isFinite(parsedValue)) {
      return parsedValue;
    }
  }

  return null;
}
