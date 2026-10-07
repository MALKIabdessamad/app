import { createFileRoute } from "@tanstack/react-router";
import { Layers } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Starter — Your next project" },
      { name: "description", content: "A fresh start for your next website or application." },
      { property: "og:title", content: "Starter — Your next project" },
      { property: "og:description", content: "A fresh start for your next website or application." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <main className="grid min-h-svh place-items-center bg-background px-6">
      <div className="text-center">
        <Layers className="mx-auto mb-6 size-10 text-primary" strokeWidth={1.5} aria-hidden="true" />
        <h1 className="text-3xl font-semibold text-foreground">Your next project.</h1>
        <p className="mt-3 text-base text-muted-foreground">A fresh start.</p>
      </div>
    </main>
  );
}
