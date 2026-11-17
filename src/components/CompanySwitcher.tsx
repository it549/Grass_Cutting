"use client";

import { switchCompany } from "@/app/(app)/actions";

export function CompanySwitcher({ current, options }: { current: string; options: { id: string; name: string }[] }) {
  if (options.length < 2) return null;
  return (
    <form action={switchCompany}>
      <select name="company" defaultValue={current} onChange={(e) => e.currentTarget.form?.requestSubmit()} aria-label="เลือกบริษัท">
        {options.map((o) => (
          <option key={o.id} value={o.id}>{o.name}</option>
        ))}
      </select>
    </form>
  );
}
