import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import AuthForm from "@/components/AuthForm";

export default async function SignupPage() {
  if (await getCurrentUser()) redirect("/dashboard");
  return <AuthForm mode="signup" />;
}
