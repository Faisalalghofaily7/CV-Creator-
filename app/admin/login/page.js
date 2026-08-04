import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getAdminSession } from "../../../lib/adminAuth";
import AdminLogin from "../../../components/AdminLogin";

export default async function AdminLoginPage() {
  const session = await getAdminSession(cookies());
  if (session) redirect("/admin");
  return <AdminLogin />;
}
