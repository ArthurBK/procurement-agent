"use client";

import { useState } from "react";
import type { SupplierRule } from "@/lib/supplierRules/types";

export type SupplierRuleRow = SupplierRule & {
  updated_at: string;
};

type DraftRule = {
  canonicalSupplier: string;
  businessCategory: SupplierRule["business_category"];
  defaultDecision: SupplierRule["default_decision"];
  notes: string;
};

const BUSINESS_CATEGORIES: SupplierRule["business_category"][] = [
  "software",
  "cloud",
  "ai",
  "telecom",
  "banking",
  "workspace",
  "professional_service",
  "marketing",
  "food",
  "transport",
  "travel",
  "retail",
  "income",
  "unknown",
];

const DEFAULT_DECISIONS: SupplierRule["default_decision"][] = [
  "auto_subscription",
  "needs_review",
  "excluded",
];

export function SupplierRulesTable({ rules }: { rules: SupplierRuleRow[] }) {
  const [rows, setRows] = useState(rules);
  const [drafts, setDrafts] = useState(() => buildDrafts(rules));
  const [pendingRuleId, setPendingRuleId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function setDraft(ruleId: string, draft: DraftRule) {
    setDrafts((currentDrafts) => ({
      ...currentDrafts,
      [ruleId]: draft,
    }));
  }

  async function updateRule(
    ruleId: string,
    payload: Record<string, unknown>,
  ) {
    setError(null);
    setPendingRuleId(ruleId);

    try {
      const response = await fetch(`/api/supplier-rules/${ruleId}`, {
        body: JSON.stringify(payload),
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      });
      const result = (await response.json()) as {
        errors?: string[];
        rule?: SupplierRuleRow;
      };

      if (!response.ok || !result.rule) {
        setError(result.errors?.[0] ?? "Unable to update supplier rule.");
        return;
      }

      setRows((currentRows) =>
        currentRows.map((row) => (row.id === ruleId ? result.rule! : row)),
      );
      setDrafts((currentDrafts) => ({
        ...currentDrafts,
        [ruleId]: toDraft(result.rule!),
      }));
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to update supplier rule.",
      );
    } finally {
      setPendingRuleId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      <section className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1180px] border-collapse text-left text-sm">
            <thead className="bg-zinc-100 text-xs uppercase text-zinc-500">
              <tr>
                <th className="px-4 py-3 font-semibold">Canonical supplier</th>
                <th className="px-4 py-3 font-semibold">Supplier key</th>
                <th className="px-4 py-3 font-semibold">Category</th>
                <th className="px-4 py-3 font-semibold">Default decision</th>
                <th className="px-4 py-3 font-semibold">Match type</th>
                <th className="px-4 py-3 font-semibold">Active</th>
                <th className="px-4 py-3 font-semibold">Updated at</th>
                <th className="px-4 py-3 font-semibold">Notes</th>
                <th className="px-4 py-3 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {rows.length > 0 ? (
                rows.map((rule) => {
                  const draft = drafts[rule.id] ?? toDraft(rule);
                  const isPending = pendingRuleId === rule.id;

                  return (
                    <tr className="bg-white" key={rule.id}>
                      <td className="px-4 py-3">
                        <input
                          className="h-9 w-44 rounded-md border border-zinc-300 px-2 text-sm"
                          onChange={(event) =>
                            setDraft(rule.id, {
                              ...draft,
                              canonicalSupplier: event.target.value,
                            })
                          }
                          value={draft.canonicalSupplier}
                        />
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-zinc-700">
                        {rule.supplier_key}
                      </td>
                      <td className="px-4 py-3">
                        <select
                          className="h-9 rounded-md border border-zinc-300 px-2 text-sm"
                          onChange={(event) =>
                            setDraft(rule.id, {
                              ...draft,
                              businessCategory: event.target
                                .value as SupplierRule["business_category"],
                            })
                          }
                          value={draft.businessCategory}
                        >
                          {BUSINESS_CATEGORIES.map((category) => (
                            <option key={category} value={category}>
                              {formatEnumLabel(category)}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-3">
                        <select
                          className="h-9 rounded-md border border-zinc-300 px-2 text-sm"
                          onChange={(event) =>
                            setDraft(rule.id, {
                              ...draft,
                              defaultDecision: event.target
                                .value as SupplierRule["default_decision"],
                            })
                          }
                          value={draft.defaultDecision}
                        >
                          {DEFAULT_DECISIONS.map((decision) => (
                            <option key={decision} value={decision}>
                              {formatEnumLabel(decision)}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-3 text-zinc-700">
                        {formatEnumLabel(rule.match_type)}
                      </td>
                      <td className="px-4 py-3 text-zinc-700">
                        {rule.active ? "Yes" : "No"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-zinc-700">
                        {formatDateTime(rule.updated_at)}
                      </td>
                      <td className="px-4 py-3">
                        <input
                          className="h-9 w-48 rounded-md border border-zinc-300 px-2 text-sm"
                          onChange={(event) =>
                            setDraft(rule.id, {
                              ...draft,
                              notes: event.target.value,
                            })
                          }
                          value={draft.notes}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <button
                            className="inline-flex h-8 items-center justify-center rounded-md border border-zinc-300 bg-white px-2.5 text-xs font-medium text-zinc-950 transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-400"
                            disabled={isPending}
                            onClick={() =>
                              updateRule(rule.id, {
                                businessCategory: draft.businessCategory,
                                canonicalSupplier: draft.canonicalSupplier,
                                defaultDecision: draft.defaultDecision,
                                notes: draft.notes.length > 0 ? draft.notes : null,
                              })
                            }
                            type="button"
                          >
                            Save
                          </button>
                          <button
                            className="inline-flex h-8 items-center justify-center rounded-md border border-zinc-300 bg-white px-2.5 text-xs font-medium text-zinc-950 transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-400"
                            disabled={isPending}
                            onClick={() =>
                              updateRule(rule.id, { active: !rule.active })
                            }
                            type="button"
                          >
                            {rule.active ? "Deactivate" : "Reactivate"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td
                    className="px-5 py-6 text-center text-zinc-500"
                    colSpan={9}
                  >
                    No supplier rules saved yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function buildDrafts(rules: SupplierRuleRow[]): Record<string, DraftRule> {
  return rules.reduce<Record<string, DraftRule>>((drafts, rule) => {
    drafts[rule.id] = toDraft(rule);
    return drafts;
  }, {});
}

function toDraft(rule: SupplierRuleRow): DraftRule {
  return {
    businessCategory: rule.business_category,
    canonicalSupplier: rule.canonical_supplier,
    defaultDecision: rule.default_decision,
    notes: rule.notes ?? "",
  };
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatEnumLabel(value: string): string {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
