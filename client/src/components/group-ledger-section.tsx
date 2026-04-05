import { useEffect, useState, type FormEvent } from "react";

import { api, ApiError } from "../api";
import type {
  ExpenseSplitMode,
  GroupDetail,
  GroupExpense,
  GroupLedger,
  LedgerExpensePayload
} from "../types";

type ExpenseDraftPayer = {
  userId: string;
  amountPaid: string;
};

type ExpenseDraftParticipant = {
  userId: string;
  included: boolean;
  percentage: string;
  amountOwed: string;
};

type ExpenseDraft = {
  title: string;
  category: LedgerExpensePayload["category"];
  splitMode: ExpenseSplitMode;
  expenseDate: string;
  payers: ExpenseDraftPayer[];
  participants: ExpenseDraftParticipant[];
};

type ExpenseView = {
  id: string;
  title: string;
  category: LedgerExpensePayload["category"];
  splitMode: ExpenseSplitMode;
  expenseDate: string;
  totalAmount: string;
  createdAt: string;
  updatedAt: string;
  createdBy: GroupExpense["createdBy"] | null;
  payers: Array<{
    userId: string;
    label: string;
    amountPaid: string;
  }>;
  shares: Array<{
    userId: string;
    amount: string;
  }>;
};

type ExpenseCreatorCache = Record<string, NonNullable<ExpenseView["createdBy"]>>;

function getDefaultPayerUserId(group: GroupDetail, currentUserId: string) {
  return group.members.some((member) => member.id === currentUserId)
    ? currentUserId
    : group.members[0]?.id ?? "";
}

function createPayerDraft(group: GroupDetail, currentUserId: string): ExpenseDraftPayer {
  return { userId: getDefaultPayerUserId(group, currentUserId), amountPaid: "" };
}

function createParticipantDrafts(group: GroupDetail): ExpenseDraftParticipant[] {
  return group.members.map((member) => ({
    userId: member.id,
    included: true,
    percentage: "",
    amountOwed: ""
  }));
}

function createEmptyDraft(group: GroupDetail, currentUserId: string): ExpenseDraft {
  return {
    title: "",
    category: "other",
    splitMode: "equal",
    expenseDate: "",
    payers: [createPayerDraft(group, currentUserId)],
    participants: createParticipantDrafts(group)
  };
}

function parseAmountToCents(amount: string) {
  const normalized = amount.trim();

  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(normalized)) {
    return 0;
  }

  const [whole, fraction = ""] = normalized.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));

  if (cents === 0) {
    return 0;
  }

  return cents;
}

function formatCents(totalCents: number) {
  return `${Math.floor(totalCents / 100)}.${String(totalCents % 100).padStart(2, "0")}`;
}

function formatPercentageHundredths(value: number) {
  const formatted = (value / 100).toFixed(2);
  return formatted.replace(/(?:\.0+|(\.\d+?)0+)$/, "$1");
}

function calculateDraftTotal(payers: ExpenseDraftPayer[]) {
  return formatCents(payers.reduce((sum, payer) => sum + parseAmountToCents(payer.amountPaid), 0));
}

function distributeEqualPercentages(userIds: string[]) {
  if (userIds.length === 0) {
    return new Map<string, string>();
  }

  const base = Math.floor(10000 / userIds.length);
  let remainder = 10000 % userIds.length;
  const result = new Map<string, string>();

  for (const userId of userIds) {
    const next = base + (remainder > 0 ? 1 : 0);
    if (remainder > 0) {
      remainder -= 1;
    }
    result.set(userId, formatPercentageHundredths(next));
  }

  return result;
}

function distributeExactAmounts(totalCents: number, userIds: string[]) {
  if (userIds.length === 0) {
    return new Map<string, string>();
  }

  const base = Math.floor(totalCents / userIds.length);
  let remainder = totalCents % userIds.length;
  const result = new Map<string, string>();

  for (const userId of userIds) {
    const next = base + (remainder > 0 ? 1 : 0);
    if (remainder > 0) {
      remainder -= 1;
    }
    result.set(userId, formatCents(next));
  }

  return result;
}

function derivePercentages(
  shares: Array<{ userId: string; amount: string }>,
  totalAmount: string
) {
  const totalCents = parseAmountToCents(totalAmount);

  if (!shares.length || totalCents === 0) {
    return new Map<string, string>();
  }

  let runningHundredths = 0;
  const result = new Map<string, string>();

  shares.forEach((share, index) => {
    const shareCents = parseAmountToCents(share.amount);
    const hundredths =
      index === shares.length - 1
        ? 10000 - runningHundredths
        : Math.round((shareCents * 10000) / totalCents);

    runningHundredths += hundredths;
    result.set(share.userId, formatPercentageHundredths(hundredths));
  });

  return result;
}

function collectNameEntries(group: GroupDetail, ledger: GroupLedger | null, expenses: GroupExpense[]) {
  const entries: Array<[string, string]> = [];

  for (const member of group.members) {
    entries.push([member.id, member.displayName ?? member.email]);
  }

  for (const member of ledger?.members ?? []) {
    entries.push([member.id, member.displayName ?? member.email]);
  }

  for (const expense of expenses) {
    entries.push([expense.createdBy.id, expense.createdBy.displayName ?? expense.createdBy.email]);

    for (const payer of expense.payers) {
      entries.push([payer.user.id, payer.user.displayName ?? payer.user.email]);
    }
  }

  return entries;
}

function buildNameMap(
  cachedNames: Record<string, string>,
  group: GroupDetail,
  ledger: GroupLedger | null,
  expenses: GroupExpense[]
) {
  const entries = new Map<string, string>(Object.entries(cachedNames));

  for (const [userId, label] of collectNameEntries(group, ledger, expenses)) {
    entries.set(userId, label);
  }

  return entries;
}

function mergeExpenses(
  expenses: GroupExpense[],
  ledger: GroupLedger | null,
  nameMap: Map<string, string>,
  creatorCache: ExpenseCreatorCache
): ExpenseView[] {
  const legacyById = new Map(expenses.map((expense) => [expense.id, expense]));
  const ledgerById = new Map((ledger?.expenses ?? []).map((expense) => [expense.id, expense]));
  const ids = new Set<string>([...legacyById.keys(), ...ledgerById.keys()]);

  return Array.from(ids).map((id) => {
    const legacyExpense = legacyById.get(id);
    const ledgerExpense = ledgerById.get(id);
    const hasLedgerExpense = Boolean(ledgerExpense);
    const totalAmountFromLedger = formatCents(
      (ledgerExpense?.payers ?? []).reduce((sum, payer) => sum + parseAmountToCents(payer.amount), 0)
    );

    return {
      id,
      title: (hasLedgerExpense ? ledgerExpense?.title : legacyExpense?.title) ?? "Untitled expense",
      category: (hasLedgerExpense ? ledgerExpense?.category : legacyExpense?.category) ?? "other",
      splitMode: (hasLedgerExpense ? ledgerExpense?.splitMode : legacyExpense?.splitMode) ?? "equal",
      expenseDate: (hasLedgerExpense ? ledgerExpense?.expenseDate : legacyExpense?.expenseDate) ?? "",
      totalAmount: hasLedgerExpense ? totalAmountFromLedger : legacyExpense?.totalAmount ?? "0.00",
      createdAt: (hasLedgerExpense ? ledgerExpense?.createdAt : legacyExpense?.createdAt) ?? "",
      updatedAt: (hasLedgerExpense ? ledgerExpense?.updatedAt : legacyExpense?.updatedAt) ?? "",
      createdBy: legacyExpense?.createdBy ?? creatorCache[id] ?? null,
      payers:
        hasLedgerExpense
          ? (ledgerExpense?.payers ?? []).map((payer) => ({
              userId: payer.userId,
              label: nameMap.get(payer.userId) ?? payer.userId,
              amountPaid: payer.amount
            }))
          : (legacyExpense?.payers ?? []).map((payer) => ({
              userId: payer.user.id,
              label: payer.user.displayName ?? payer.user.email,
              amountPaid: payer.amountPaid
            })),
      shares: ledgerExpense?.shares ?? []
    };
  });
}

function buildDraftFromExpense(
  expense: ExpenseView,
  group: GroupDetail,
  currentUserId: string
): ExpenseDraft {
  const percentages = derivePercentages(expense.shares, expense.totalAmount);

  return {
    title: expense.title,
    category: expense.category,
    splitMode: expense.splitMode,
    expenseDate: expense.expenseDate,
    payers:
      expense.payers.map((payer) => ({
        userId: payer.userId,
        amountPaid: payer.amountPaid
      })) ?? [createPayerDraft(group, currentUserId)],
    participants: group.members.map((member) => {
      const share = expense.shares.find((entry) => entry.userId === member.id);

      return {
        userId: member.id,
        included: expense.shares.length === 0 ? true : Boolean(share),
        percentage: share ? (percentages.get(member.id) ?? "") : "",
        amountOwed: share?.amount ?? ""
      };
    })
  };
}

function orderExpenses(expenses: ExpenseView[]) {
  return [...expenses].sort((left, right) => {
    const expenseDateDelta = new Date(left.expenseDate).getTime() - new Date(right.expenseDate).getTime();

    if (expenseDateDelta !== 0) {
      return expenseDateDelta;
    }

    return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
  });
}

function formatBalanceLabel(label: string, amount: string) {
  if (amount.startsWith("-")) {
    return `${label} owes ${amount.slice(1)}`;
  }

  if (amount === "0.00") {
    return `${label} is settled up`;
  }

  return `${label} is owed ${amount}`;
}

function formatDateLabel(value: string) {
  return value.slice(0, 10);
}

export function GroupLedgerSection({
  group,
  currentUserId
}: {
  group: GroupDetail;
  currentUserId: string;
}) {
  const [expenses, setExpenses] = useState<GroupExpense[]>([]);
  const [ledger, setLedger] = useState<GroupLedger | null>(null);
  const [draft, setDraft] = useState<ExpenseDraft>(() => createEmptyDraft(group, currentUserId));
  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isSettlingKey, setIsSettlingKey] = useState<string | null>(null);
  const [hasLedgerSupport, setHasLedgerSupport] = useState(false);
  const [cachedNames, setCachedNames] = useState<Record<string, string>>({});
  const [cachedExpenseCreators, setCachedExpenseCreators] = useState<ExpenseCreatorCache>({});

  const memberIdsSignature = group.members.map((member) => member.id).join(",");

  async function loadWorkspace() {
    setIsLoading(true);

    const [ledgerResult, expensesResult] = await Promise.allSettled([
      api.getGroupLedger(group.id),
      api.listExpenses(group.id)
    ]);

    if (ledgerResult.status === "fulfilled") {
      setLedger(ledgerResult.value);
      setHasLedgerSupport(true);
    } else {
      setLedger(null);
      setHasLedgerSupport(false);
    }

    if (expensesResult.status === "fulfilled") {
      setExpenses(expensesResult.value.expenses);
    }

    if (expensesResult.status === "rejected") {
      setError(
        expensesResult.reason instanceof ApiError
          ? expensesResult.reason.message
          : "Unable to load expenses."
      );
    } else {
      setError("");
    }

    setIsLoading(false);
  }

  async function refreshLedger() {
    if (!hasLedgerSupport) {
      return;
    }

    try {
      const response = await api.getGroupLedger(group.id);
      setLedger(response);
    } catch {
      // Keep the last successful ledger view if a refresh is unavailable.
    }
  }

  useEffect(() => {
    void loadWorkspace();
    setDraft(createEmptyDraft(group, currentUserId));
    setEditingExpenseId(null);
    setSuccessMessage("");
  }, [group.id, currentUserId, memberIdsSignature]);

  useEffect(() => {
    setCachedNames((current) => {
      let changed = false;
      const next = { ...current };

      for (const [userId, label] of collectNameEntries(group, ledger, expenses)) {
        if (next[userId] !== label) {
          next[userId] = label;
          changed = true;
        }
      }

      return changed ? next : current;
    });
  }, [group, ledger, expenses]);

  useEffect(() => {
    setCachedExpenseCreators((current) => {
      let changed = false;
      const next = { ...current };

      for (const expense of expenses) {
        const cachedCreator = next[expense.id];

        if (
          !cachedCreator ||
          cachedCreator.id !== expense.createdBy.id ||
          cachedCreator.email !== expense.createdBy.email ||
          cachedCreator.displayName !== expense.createdBy.displayName
        ) {
          next[expense.id] = expense.createdBy;
          changed = true;
        }
      }

      return changed ? next : current;
    });
  }, [expenses]);

  const liveTotal = calculateDraftTotal(draft.payers);
  const nameMap = buildNameMap(cachedNames, group, ledger, expenses);
  const orderedExpenses = orderExpenses(mergeExpenses(expenses, ledger, nameMap, cachedExpenseCreators));

  function updatePayer(index: number, key: keyof ExpenseDraftPayer, value: string) {
    setDraft((current) => ({
      ...current,
      payers: current.payers.map((payer, payerIndex) =>
        payerIndex === index ? { ...payer, [key]: value } : payer
      )
    }));
  }

  function addPayer() {
    setDraft((current) => ({
      ...current,
      payers: [...current.payers, createPayerDraft(group, currentUserId)]
    }));
  }

  function removePayer(index: number) {
    setDraft((current) => {
      if (current.payers.length === 1) {
        return current;
      }

      return {
        ...current,
        payers: current.payers.filter((_, payerIndex) => payerIndex !== index)
      };
    });
  }

  function updateParticipant(index: number, patch: Partial<ExpenseDraftParticipant>) {
    setDraft((current) => ({
      ...current,
      participants: current.participants.map((participant, participantIndex) =>
        participantIndex === index ? { ...participant, ...patch } : participant
      )
    }));
  }

  function handleSplitModeChange(nextSplitMode: ExpenseSplitMode) {
    setDraft((current) => {
      const includedIds = current.participants
        .filter((participant) => participant.included)
        .map((participant) => participant.userId);
      const totalCents = parseAmountToCents(calculateDraftTotal(current.payers));
      const percentageDefaults = distributeEqualPercentages(includedIds);
      const exactDefaults = distributeExactAmounts(totalCents, includedIds);

      return {
        ...current,
        splitMode: nextSplitMode,
        participants: current.participants.map((participant) => ({
          ...participant,
          percentage:
            nextSplitMode === "percentage"
              ? participant.percentage || percentageDefaults.get(participant.userId) || ""
              : participant.percentage,
          amountOwed:
            nextSplitMode === "exact"
              ? participant.amountOwed || exactDefaults.get(participant.userId) || ""
              : participant.amountOwed
        }))
      };
    });
  }

  function resetForm() {
    setEditingExpenseId(null);
    setDraft(createEmptyDraft(group, currentUserId));
  }

  function buildExpensePayload(currentDraft: ExpenseDraft): LedgerExpensePayload {
    return {
      title: currentDraft.title,
      category: currentDraft.category,
      splitMode: currentDraft.splitMode,
      expenseDate: currentDraft.expenseDate,
      payers: currentDraft.payers,
      participants: currentDraft.participants.map((participant) => {
        if (!participant.included) {
          return {
            userId: participant.userId,
            included: false
          };
        }

        if (currentDraft.splitMode === "percentage") {
          return {
            userId: participant.userId,
            included: true,
            percentage: participant.percentage
          };
        }

        if (currentDraft.splitMode === "exact") {
          return {
            userId: participant.userId,
            included: true,
            amountOwed: participant.amountOwed
          };
        }

        return {
          userId: participant.userId,
          included: true
        };
      })
    };
  }

  function upsertExpense(expense: GroupExpense) {
    setExpenses((current) => {
      const remainingExpenses = current.filter((existingExpense) => existingExpense.id !== expense.id);
      return [...remainingExpenses, expense];
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setError("");
    setSuccessMessage("");

    const payload = buildExpensePayload(draft);

    try {
      if (editingExpenseId) {
        const response = await api.updateExpense(editingExpenseId, payload);
        upsertExpense(response.expense);
        setSuccessMessage("Expense updated.");
      } else {
        const response = await api.createExpense(group.id, payload);
        upsertExpense(response.expense);
        setSuccessMessage("Expense saved.");
      }

      resetForm();
      void refreshLedger();
    } catch (caughtError) {
      setError(caughtError instanceof ApiError ? caughtError.message : "Unable to save the expense.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete(expenseId: string) {
    setError("");
    setSuccessMessage("");

    try {
      await api.deleteExpense(expenseId);
      setExpenses((current) => current.filter((expense) => expense.id !== expenseId));
      if (editingExpenseId === expenseId) {
        resetForm();
      }
      setSuccessMessage("Expense deleted.");
      void refreshLedger();
    } catch (caughtError) {
      setError(caughtError instanceof ApiError ? caughtError.message : "Unable to delete the expense.");
    }
  }

  async function handleSettleSuggestion(suggestion: {
    fromUserId: string;
    toUserId: string;
    amount: string;
  }) {
    const settlingKey = `${suggestion.fromUserId}-${suggestion.toUserId}-${suggestion.amount}`;
    setIsSettlingKey(settlingKey);
    setError("");
    setSuccessMessage("");

    try {
      await api.createSettlement(group.id, suggestion);
      await refreshLedger();
      setSuccessMessage("Settlement recorded.");
    } catch (caughtError) {
      setError(caughtError instanceof ApiError ? caughtError.message : "Unable to record that settlement.");
    } finally {
      setIsSettlingKey(null);
    }
  }

  return (
    <section className="surface-card expense-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Group ledger</p>
          <h2>Track shared spending</h2>
        </div>
        <strong className="expense-total-chip">Total: {liveTotal}</strong>
      </div>

      <form className="expense-form" onSubmit={handleSubmit}>
        <label className="field">
          <span>Expense title</span>
          <input
            value={draft.title}
            onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
          />
        </label>

        <div className="ledger-form-grid">
          <label className="field">
            <span>Category</span>
            <select
              aria-label="Category"
              value={draft.category}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  category: event.target.value as LedgerExpensePayload["category"]
                }))
              }
            >
              <option value="food">Food</option>
              <option value="transport">Transport</option>
              <option value="housing">Housing</option>
              <option value="entertainment">Entertainment</option>
              <option value="other">Other</option>
            </select>
          </label>

          <label className="field">
            <span>Split mode</span>
            <select
              aria-label="Split mode"
              value={draft.splitMode}
              onChange={(event) => handleSplitModeChange(event.target.value as ExpenseSplitMode)}
            >
              <option value="equal">Equal</option>
              <option value="percentage">By percentage</option>
              <option value="exact">By exact amount</option>
            </select>
          </label>

          <label className="field">
            <span>Expense date</span>
            <input
              type="date"
              value={draft.expenseDate}
              onChange={(event) =>
                setDraft((current) => ({ ...current, expenseDate: event.target.value }))
              }
            />
          </label>
        </div>

        {draft.payers.map((payer, index) => (
          <div className="payer-row" key={`${editingExpenseId ?? "new"}-${index}`}>
            <label className="field">
              <span>{`Payer ${index + 1}`}</span>
              <select
                aria-label={`Payer ${index + 1}`}
                value={payer.userId}
                onChange={(event) => updatePayer(index, "userId", event.target.value)}
              >
                {group.members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.displayName ?? member.email}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>{`Amount paid by payer ${index + 1}`}</span>
              <input
                aria-label={`Amount paid by payer ${index + 1}`}
                inputMode="decimal"
                value={payer.amountPaid}
                onChange={(event) => updatePayer(index, "amountPaid", event.target.value)}
              />
            </label>

            <button
              className="secondary-button"
              disabled={draft.payers.length === 1}
              onClick={() => removePayer(index)}
              type="button"
            >
              Remove payer
            </button>
          </div>
        ))}

        <div className="participant-picker">
          <div className="section-heading compact-heading">
            <div>
              <p className="eyebrow">Participants</p>
              <h3>Included members</h3>
            </div>
          </div>

          <div className="participant-grid">
            {draft.participants.map((participant, index) => {
              const label =
                group.members.find((member) => member.id === participant.userId)?.displayName ??
                group.members.find((member) => member.id === participant.userId)?.email ??
                participant.userId;

              return (
                <article className="participant-card" key={participant.userId}>
                  <label className="participant-toggle">
                    <input
                      aria-label={`Include ${label}`}
                      checked={participant.included}
                      onChange={(event) =>
                        updateParticipant(index, {
                          included: event.target.checked,
                          percentage: event.target.checked ? participant.percentage : "",
                          amountOwed: event.target.checked ? participant.amountOwed : ""
                        })
                      }
                      type="checkbox"
                    />
                    <span>{label}</span>
                  </label>

                  {participant.included && draft.splitMode === "percentage" ? (
                    <label className="field">
                      <span>{`Percentage for ${label}`}</span>
                      <input
                        aria-label={`Percentage for ${label}`}
                        inputMode="decimal"
                        value={participant.percentage}
                        onChange={(event) =>
                          updateParticipant(index, { percentage: event.target.value })
                        }
                      />
                    </label>
                  ) : null}

                  {participant.included && draft.splitMode === "exact" ? (
                    <label className="field">
                      <span>{`Amount owed by ${label}`}</span>
                      <input
                        aria-label={`Amount owed by ${label}`}
                        inputMode="decimal"
                        value={participant.amountOwed}
                        onChange={(event) =>
                          updateParticipant(index, { amountOwed: event.target.value })
                        }
                      />
                    </label>
                  ) : null}
                </article>
              );
            })}
          </div>
        </div>

        <div className="button-row">
          <button className="secondary-button" onClick={addPayer} type="button">
            Add payer
          </button>
          {editingExpenseId ? (
            <button className="secondary-button" onClick={resetForm} type="button">
              Cancel edit
            </button>
          ) : null}
          <button className="primary-button" disabled={isSaving} type="submit">
            {isSaving ? "Saving..." : "Save expense"}
          </button>
        </div>
      </form>

      {error ? <p className="form-error">{error}</p> : null}
      {successMessage ? <p className="form-success">{successMessage}</p> : null}
      {isLoading ? <p className="muted-copy">Loading expenses...</p> : null}
      {!isLoading && orderedExpenses.length === 0 ? (
        <p className="muted-copy">No expenses recorded yet.</p>
      ) : null}

      <div className="stack-list">
        {orderedExpenses.map((expense) => (
          <article className="expense-card" data-testid="expense-card" key={expense.id}>
            <div className="expense-card-header">
              <div>
                <h3>{expense.title}</h3>
                <p>{expense.expenseDate}</p>
              </div>
              <strong>{`Total paid ${expense.totalAmount}`}</strong>
            </div>

            <p>{`Category: ${expense.category}`}</p>
            <p>{`Split mode: ${expense.splitMode}`}</p>
            {expense.createdBy ? (
              <p>{`Created by ${expense.createdBy.displayName ?? expense.createdBy.email}`}</p>
            ) : null}

            <ul className="payer-breakdown">
              {expense.payers.map((payer) => (
                <li key={`${expense.id}-${payer.userId}`}>{`${payer.label} paid ${payer.amountPaid}`}</li>
              ))}
            </ul>

            {expense.createdBy?.id === currentUserId ? (
              <div className="button-row">
                <button
                  className="secondary-button"
                  onClick={() => {
                    setEditingExpenseId(expense.id);
                    setDraft(buildDraftFromExpense(expense, group, currentUserId));
                  }}
                  type="button"
                >
                  Edit expense
                </button>
                <button
                  className="secondary-button"
                  onClick={() => void handleDelete(expense.id)}
                  type="button"
                >
                  Delete expense
                </button>
              </div>
            ) : null}
          </article>
        ))}
      </div>

      {ledger ? (
        <div className="ledger-grid">
          <section className="ledger-panel">
            <div className="section-heading compact-heading">
              <div>
                <p className="eyebrow">Balances</p>
                <h3>Current balances</h3>
              </div>
            </div>

            <div className="stack-list">
              {ledger.balances.map((balance) => (
                <article className="ledger-stat-card" key={balance.userId}>
                  <strong>{nameMap.get(balance.userId) ?? balance.userId}</strong>
                  <span>{formatBalanceLabel(nameMap.get(balance.userId) ?? balance.userId, balance.balance)}</span>
                </article>
              ))}
            </div>
          </section>

          <section className="ledger-panel">
            <div className="section-heading compact-heading">
              <div>
                <p className="eyebrow">Settle up</p>
                <h3>Settle-up suggestions</h3>
              </div>
            </div>

            {ledger.settleUpSuggestions.length === 0 ? (
              <p className="muted-copy">No settle-up suggestions right now.</p>
            ) : (
              <ul aria-label="Settle-up suggestions" className="stack-list suggestion-list">
                {ledger.settleUpSuggestions.map((suggestion) => {
                  const key = `${suggestion.fromUserId}-${suggestion.toUserId}-${suggestion.amount}`;

                  return (
                    <li className="ledger-action-card" key={key}>
                      <div>
                        <strong>
                          {(nameMap.get(suggestion.fromUserId) ?? suggestion.fromUserId) +
                            " pays " +
                            (nameMap.get(suggestion.toUserId) ?? suggestion.toUserId) +
                            " " +
                            suggestion.amount}
                        </strong>
                      </div>
                      <button
                        className="primary-button"
                        disabled={isSettlingKey === key}
                        onClick={() => void handleSettleSuggestion(suggestion)}
                        type="button"
                      >
                        {isSettlingKey === key ? "Saving..." : "Mark paid"}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      ) : null}

      {ledger ? (
        <section className="ledger-panel">
          <div className="section-heading compact-heading">
            <div>
              <p className="eyebrow">History</p>
              <h3>Settlement history</h3>
            </div>
          </div>

          {ledger.settlements.length === 0 ? (
            <p className="muted-copy">No settlements recorded yet.</p>
          ) : (
            <ul aria-label="Settlement history" className="stack-list settlement-history-list">
              {ledger.settlements.map((settlement) => (
                <li className="ledger-action-card" key={settlement.id}>
                  <div>
                    <strong>
                      {(nameMap.get(settlement.fromUserId) ?? settlement.fromUserId) +
                        " paid " +
                        (nameMap.get(settlement.toUserId) ?? settlement.toUserId) +
                        " " +
                        settlement.amount}
                    </strong>
                    <p>{formatDateLabel(settlement.paidAt)}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </section>
  );
}
