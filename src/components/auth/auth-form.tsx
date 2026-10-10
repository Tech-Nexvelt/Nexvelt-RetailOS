"use client";

import { useActionState } from "react";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import type { FormState } from "@/server/auth/actions";

interface FieldSpec {
  name: string;
  label: string;
  type: "email" | "password";
  autoComplete: string;
  hint?: string;
}

/** One small form used by sign-in, forgot-password and set-password. */
export function AuthForm({
  action,
  fields,
  submitLabel,
  hidden,
}: {
  action: (prev: FormState, form: FormData) => Promise<FormState>;
  fields: FieldSpec[];
  submitLabel: string;
  hidden?: Record<string, string>;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      {Object.entries(hidden ?? {}).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {fields.map((f) => (
        <Field key={f.name} label={f.label} htmlFor={f.name} hint={f.hint}>
          <Input
            id={f.name}
            name={f.name}
            type={f.type}
            autoComplete={f.autoComplete}
            required
            disabled={pending}
          />
        </Field>
      ))}
      {state.message ? (
        <Banner tone={state.ok ? "success" : "error"}>{state.message}</Banner>
      ) : null}
      <Button type="submit" variant="primary" size="lg" disabled={pending}>
        {pending ? "Please wait…" : submitLabel}
      </Button>
    </form>
  );
}
