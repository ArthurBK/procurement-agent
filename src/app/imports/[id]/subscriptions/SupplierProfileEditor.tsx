import { useState } from "react";
import type { LogoSource } from "@/lib/suppliers/types";

export type SupplierProfileForm = {
  displayName: string;
  domain: string;
  logoUrl: string;
  logoSource: LogoSource;
};

type LogoSearchSuggestion = {
  name: string;
  domain: string;
  logoUrl: string | null;
};

type SearchResponse = {
  error?: string;
  results?: LogoSearchSuggestion[];
};

export function SupplierProfileEditor({
  disabled,
  form,
  onCancel,
  onChange,
  onSubmit,
}: {
  disabled: boolean;
  form: SupplierProfileForm;
  onCancel: () => void;
  onChange: <Field extends keyof SupplierProfileForm>(
    field: Field,
    value: SupplierProfileForm[Field],
  ) => void;
  onSubmit: () => void;
}) {
  const [searchQuery, setSearchQuery] = useState(form.displayName);
  const [suggestions, setSuggestions] = useState<LogoSearchSuggestion[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);

  async function searchLogos() {
    const query = searchQuery.trim();

    setSearchError(null);

    if (query.length < 2) {
      setSuggestions([]);
      return;
    }

    setIsSearching(true);

    try {
      const response = await fetch(
        `/api/supplier-profiles/search?q=${encodeURIComponent(query)}`,
      );
      const result = (await response.json()) as SearchResponse;

      if (!response.ok) {
        setSearchError(result.error ?? "Unable to search logos.");
        return;
      }

      setSuggestions(result.results ?? []);
    } catch (requestError) {
      setSearchError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to search logos.",
      );
    } finally {
      setIsSearching(false);
    }
  }

  function applySuggestion(suggestion: LogoSearchSuggestion) {
    onChange("displayName", suggestion.name);
    onChange("domain", suggestion.domain);
    onChange("logoUrl", suggestion.logoUrl ?? "");
    onChange("logoSource", "logo_dev");
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
        <label className="flex flex-col gap-1 text-xs font-medium text-zinc-600">
          Search logo
          <input
            className="h-9 rounded-md border border-zinc-300 bg-white px-3 text-sm font-normal text-zinc-950"
            disabled={disabled || isSearching}
            onChange={(event) => setSearchQuery(event.target.value)}
            value={searchQuery}
          />
        </label>
        <div className="flex items-end">
          <button
            className="inline-flex h-9 items-center justify-center rounded-md border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-950 transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-400"
            disabled={disabled || isSearching}
            onClick={() => void searchLogos()}
            type="button"
          >
            {isSearching ? "Searching..." : "Search"}
          </button>
        </div>
      </div>

      {searchError ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {searchError}
        </div>
      ) : null}

      {suggestions.length > 0 ? (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {suggestions.map((suggestion) => (
            <LogoSuggestion
              key={`${suggestion.name}-${suggestion.domain}`}
              onUse={() => applySuggestion(suggestion)}
              suggestion={suggestion}
            />
          ))}
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
        <label className="flex flex-col gap-1 text-xs font-medium text-zinc-600">
          Display name
          <input
            className="h-9 rounded-md border border-zinc-300 bg-white px-3 text-sm font-normal text-zinc-950"
            disabled={disabled}
            onChange={(event) => onChange("displayName", event.target.value)}
            value={form.displayName}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-zinc-600">
          Domain
          <input
            className="h-9 rounded-md border border-zinc-300 bg-white px-3 text-sm font-normal text-zinc-950"
            disabled={disabled}
            onChange={(event) => onChange("domain", event.target.value)}
            value={form.domain}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-zinc-600">
          Logo URL
          <input
            className="h-9 rounded-md border border-zinc-300 bg-white px-3 text-sm font-normal text-zinc-950"
            disabled={disabled}
            onChange={(event) => {
              onChange("logoUrl", event.target.value);
              onChange("logoSource", event.target.value.trim() ? "manual" : "none");
            }}
            value={form.logoUrl}
          />
        </label>
        <div className="flex items-end gap-2">
          <button
            className="inline-flex h-9 items-center justify-center rounded-md bg-zinc-950 px-3 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
            disabled={disabled}
            type="submit"
          >
            {disabled ? "Saving..." : "Save"}
          </button>
          <button
            className="inline-flex h-9 items-center justify-center rounded-md border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-950 transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-400"
            disabled={disabled}
            onClick={onCancel}
            type="button"
          >
            Cancel
          </button>
        </div>
      </div>
    </form>
  );
}

function LogoSuggestion({
  onUse,
  suggestion,
}: {
  onUse: () => void;
  suggestion: LogoSearchSuggestion;
}) {
  return (
    <div className="flex items-center gap-3 rounded-md border border-zinc-200 bg-white p-3">
      {suggestion.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          alt={`${suggestion.name} logo`}
          className="h-8 w-8 shrink-0 rounded-md border border-zinc-200 bg-white object-contain"
          height={32}
          src={suggestion.logoUrl}
          width={32}
        />
      ) : (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-zinc-200 bg-zinc-100 text-xs font-semibold text-zinc-600">
          {suggestion.name.charAt(0).toUpperCase() || "?"}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-zinc-950">
          {suggestion.name}
        </div>
        <div className="truncate text-xs text-zinc-500">{suggestion.domain}</div>
      </div>
      <button
        className="inline-flex h-8 items-center justify-center rounded-md border border-zinc-300 bg-white px-2.5 text-xs font-medium text-zinc-950 transition-colors hover:bg-zinc-100"
        onClick={onUse}
        type="button"
      >
        Use this
      </button>
    </div>
  );
}
