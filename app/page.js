import { cookies } from "next/headers";
import UserFlow from "../components/UserFlow";
import { SESSION_COOKIE, getActiveSessionCode } from "../lib/userSession";

// Server Component so a page refresh can resume an already-validated (but
// not yet consumed) access code from the session cookie instead of forcing
// the user back through the gate and risking loss of their single-use code.
export default async function Page() {
  const token = cookies().get(SESSION_COOKIE)?.value;
  const initialAccessCode = await getActiveSessionCode(token).catch((err) => {
    console.error("Failed to resolve active user session:", err);
    return null;
  });
  return <UserFlow initialAccessCode={initialAccessCode} />;
}
