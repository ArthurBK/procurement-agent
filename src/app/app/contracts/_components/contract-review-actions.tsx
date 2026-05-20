"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

type ReviewActionKind =
  | "confirm_cancellation"
  | "confirm_match"
  | "ignore_match"
  | "keep_active";

type ContractReviewActionsProps = {
  contractId: string | null;
  linkId: string;
  matchScore: number;
  reviewKind: "missing_contract" | "possible_cancellation" | "possible_match";
};

export function ContractReviewActions({
  contractId,
  linkId,
  matchScore,
  reviewKind,
}: ContractReviewActionsProps) {
  const router = useRouter();
  const [pendingAction, setPendingAction] = useState<ReviewActionKind | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  async function runAction(action: ReviewActionKind) {
    setError(null);
    setPendingAction(action);

    try {
      const response =
        action === "confirm_cancellation" || action === "keep_active"
          ? await updateContractReview({ action, contractId })
          : await updateContractMatch({ action, linkId, matchScore });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as
          | { errors?: string[] }
          | null;
        throw new Error(body?.errors?.[0] ?? "Unable to update review.");
      }

      router.refresh();
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : "Unable to update review.",
      );
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {reviewKind === "possible_cancellation" ? (
          <>
            <ActionButton
              disabled={!contractId || pendingAction !== null}
              isLoading={pendingAction === "confirm_cancellation"}
              onClick={() => runAction("confirm_cancellation")}
              tone="danger"
            >
              Confirm cancelled
            </ActionButton>
            <ActionButton
              disabled={!contractId || pendingAction !== null}
              isLoading={pendingAction === "keep_active"}
              onClick={() => runAction("keep_active")}
            >
              Still active
            </ActionButton>
          </>
        ) : null}

        {reviewKind === "possible_match" ? (
          <>
            <ActionButton
              disabled={pendingAction !== null}
              isLoading={pendingAction === "confirm_match"}
              onClick={() => runAction("confirm_match")}
              tone="primary"
            >
              Confirm match
            </ActionButton>
            <ActionButton
              disabled={pendingAction !== null}
              isLoading={pendingAction === "ignore_match"}
              onClick={() => runAction("ignore_match")}
            >
              Ignore
            </ActionButton>
          </>
        ) : null}

        {reviewKind === "missing_contract" ? (
          <ActionButton
            disabled={pendingAction !== null}
            isLoading={pendingAction === "ignore_match"}
            onClick={() => runAction("ignore_match")}
          >
            Ignore
          </ActionButton>
        ) : null}

        {contractId ? (
          <Link
            className="inline-flex h-8 items-center rounded-md border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50"
            href={`/app/contracts/${contractId}`}
          >
            View details
          </Link>
        ) : null}
      </div>
      {error ? <p className="text-xs font-medium text-red-600">{error}</p> : null}
    </div>
  );
}

function ActionButton({
  children,
  disabled,
  isLoading,
  onClick,
  tone = "secondary",
}: {
  children: string;
  disabled: boolean;
  isLoading: boolean;
  onClick: () => void;
  tone?: "danger" | "primary" | "secondary";
}) {
  const className =
    tone === "danger"
      ? "border-red-200 bg-red-50 text-red-700 hover:bg-red-100 disabled:bg-red-50 disabled:text-red-300"
      : tone === "primary"
        ? "border-zinc-950 bg-zinc-950 text-white hover:bg-zinc-800 disabled:border-zinc-300 disabled:bg-zinc-300"
        : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50 disabled:text-zinc-300";

  return (
    <button
      className={`inline-flex h-8 items-center rounded-md border px-3 text-xs font-medium transition disabled:cursor-not-allowed ${className}`}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {isLoading ? "Saving..." : children}
    </button>
  );
}

function updateContractReview({
  action,
  contractId,
}: {
  action: "confirm_cancellation" | "keep_active";
  contractId: string | null;
}) {
  if (!contractId) {
    return Promise.resolve(
      Response.json({ errors: ["Contract is missing."] }, { status: 400 }),
    );
  }

  return fetch(`/api/contracts/${contractId}/review`, {
    body: JSON.stringify({ action }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
}

function updateContractMatch({
  action,
  linkId,
  matchScore,
}: {
  action: "confirm_match" | "ignore_match";
  linkId: string;
  matchScore: number;
}) {
  const isConfirm = action === "confirm_match";

  return fetch(`/api/contract-app-links/${linkId}`, {
    body: JSON.stringify({
      matchReason: isConfirm
        ? "Match confirmed manually."
        : "Review item ignored manually.",
      matchScore: isConfirm ? Math.max(matchScore, 0.99) : matchScore,
      matchStatus: isConfirm ? "matched" : "ignored",
    }),
    headers: { "Content-Type": "application/json" },
    method: "PATCH",
  });
}
