import { SettingsTabs } from "@/components/Nav";
import { requireCompany } from "@/lib/context";
import { pendingJoins } from "@/lib/data/join";

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const { company, perm } = await requireCompany();
  const pending = perm.members ? await pendingJoins(company.id) : 0;
  return (
    <div className="pad">
      <div className="hd"><div><div className="eyebrow">Settings</div><h2>ตั้งค่า</h2></div></div>
      <SettingsTabs owner={perm.members} pending={pending} />
      {children}
    </div>
  );
}
