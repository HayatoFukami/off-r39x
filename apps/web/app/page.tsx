import { SITE_NAME } from "../src/config/site";

export default function HomePage() {
  return (
    <div className="rounded-base bg-hero-gradient px-4 py-12 text-brand-foreground">
      <h1 className="text-2xl font-bold">{SITE_NAME}</h1>
    </div>
  );
}
