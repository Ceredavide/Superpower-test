import { useEffect, useState, type FormEvent } from "react";

import { api, ApiError } from "../api";
import type { ExpensePayload, GroupDetail, GroupExpense } from "../types";

type ExpenseDraft = {
  title: string;
  expenseDate: string;
  payers: Array<{ userId: string; amountPaid: string }>;
};

function getDefaultPayerUserId(group: GroupDetail, currentUserId: string) {
  return group.members.some((member) => member.id === currentUserId)
    ? currentUserId
    : group.members[0]?.id ?? "";
}

function createPayerDraft(group: GroupDetail, currentUserId: string) {
  return { userId: getDefaultPayerUserId(group, currentUserId), amountPaid: "" };
}

function createEmptyDraft(group: GroupDetail, currentUserId: string): ExpenseDraft {
  return {
    title: "",
    expenseDate: "",
    payers: [createPayerDraft(group, currentUserId)]
  };
}

function parseAmountToCents(amount: string) {
  const normalized = amount.trim();

  if (!normalized) {
    return 0;
  }

  const match = normalized.match(/^(\d*)(?:\.(\d{0,2})\d*)?$/);

  if (!match) {
    return 0;
  }

  const whole = Number(match[1] || "0") * 100;
  const fraction = Number((match[2] ?? "").padEnd(2, "0"));

  return whole + fraction;
}

function formatCents(totalCents: number) {
  return `${Math.floor(totalCents / 100)}.${String(totalCents % 100).padStart(2, "0")}`;
}

function calculateDraftTotal(payers: ExpenseDraft["payers"]) {
  return formatCents(payers.reduce((sum, payer) => sum + parseAmountToCents(payer.amountPaid), 0));
}

export function GroupExpensesSection({
  group,
  currentUserId
}: {
  group: GroupDetail;
  currentUserId: string;
}) {
  const [expenses, setExpenses] = useState<GroupExpense[]>([]);
  const [draft, setDraft] = useState<ExpenseDraft>(() => createEmptyDraft(group, currentUserId));
  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  async function loadExpenses() {
    setIsLoading(true);

    try {
      const response = await api.listExpenses(group.id);
      setExpenses(response.expenses);
      setError("");
    } catch (caughtError) {
      setError(caughtError instanceof ApiError ? caughtError.message : "Unable to load expenses.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadExpenses();
    setDraft(createEmptyDraft(group, currentUserId));
    setEditingExpenseId(null);
  }, [group.id, currentUserId]);

  const liveTotal = calculateDraftTotal(draft.payers);

  function updatePayer(index: number, key: "userId" | "amountPaid", value: string) {
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

  function resetForm() {
    setEditingExpenseId(null);
    setDraft(createEmptyDraft(group, currentUserId));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setError("");
    setSuccessMessage("");

    const payload: ExpensePayload = {
      title: draft.title,
      expenseDate: draft.expenseDate,
      payers: draft.payers
    };

    try {
      if (editingExpenseId) {
        await api.updateExpense(editingExpenseId, payload);
        setSuccessMessage("Expense updated.");
      } else {
        await api.createExpense(group.id, payload);
        setSuccessMessage("Expense saved.");
      }

      resetForm();
      await loadExpenses();
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
      if (editingExpenseId === expenseId) {
        resetForm();
      }
      setSuccessMessage("Expense deleted.");
      await loadExpenses();
    } catch (caughtError) {
      setError(caughtError instanceof ApiError ? caughtError.message : "Unable to delete the expense.");
    }
  }

  const orderedExpenses = [...expenses].sort((left, right) => {
    const expenseDateDelta = new Date(left.expenseDate).getTime() - new Date(right.expenseDate).getTime();

    if (expenseDateDelta !== 0) {
      return expenseDateDelta;
    }

    return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
  });

  return (
    <section className="surface-card expense-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Group expenses</p>
          <h2>Track shared spending</h2>
        </div>
        <strong className="expense-total-chip">Total: {liveTotal}</strong>
      </div>

      <form className="expense-form" onSubmit={handleSubmit}>
        <label className="field">
          <span>Expense title</span>
          <input
            value={draft.title}
            onChange={(event) => setDraft({ ...draft, title: event.target.value })}
          />
        </label>

        <label className="field">
          <span>Expense date</span>
          <input
            type="date"
            value={draft.expenseDate}
            onChange={(event) => setDraft({ ...draft, expenseDate: event.target.value })}
          />
        </label>

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

            <p>{`Created by ${expense.createdBy.displayName ?? expense.createdBy.email}`}</p>

            <ul className="payer-breakdown">
              {expense.payers.map((payer) => (
                <li key={`${expense.id}-${payer.user.id}`}>
                  {`${payer.user.displayName ?? payer.user.email} paid ${payer.amountPaid}`}
                </li>
              ))}
            </ul>

            {expense.createdBy.id === currentUserId ? (
              <div className="button-row">
                <button
                  className="secondary-button"
                  onClick={() => {
                    setEditingExpenseId(expense.id);
                    setDraft({
                      title: expense.title,
                      expenseDate: expense.expenseDate,
                      payers: expense.payers.map((payer) => ({
                        userId: payer.user.id,
                        amountPaid: payer.amountPaid
                      }))
                    });
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
    </section>
  );
}
