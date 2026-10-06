import LoginForm from "./LoginForm";

export const metadata = { title: "Sign in | CardioLens" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams; // searchParams is a Promise in Next 15+
  return (
    <main className="login-wrap">
      <LoginForm next={next} />
    </main>
  );
}
