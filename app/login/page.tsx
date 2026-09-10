import LoginForm from "./login-form";
export const dynamic = "force-dynamic";
export default function LoginPage() {
  const configured = !!(process.env.FIREBASE_API_KEY && process.env.FIREBASE_AUTH_DOMAIN && process.env.GOOGLE_CLOUD_PROJECT);
  return <LoginForm config={configured ? { apiKey: process.env.FIREBASE_API_KEY!, authDomain: process.env.FIREBASE_AUTH_DOMAIN!, projectId: process.env.GOOGLE_CLOUD_PROJECT! } : null} />;
}
