import { SettingsTabs } from "@/components/Nav";
import { requireCompany } from "@/lib/context";

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const { perm } = await requireCompany();
  return (
    <div className="pad">
      <div className="hd"><div><div className="eyebrow">Settings</div><h2>ตั้งค่า</h2></div></div>
      <SettingsTabs owner={perm.members} />
      {children}
    </div>
  );
}
