import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getAdminSession } from "../../lib/adminAuth";
import AdminCodes from "../../components/AdminCodes";

export default async function AdminPage() {
  const session = await getAdminSession(cookies());
  if (!session) redirect("/admin/login");
  return <AdminCodes />;
}
