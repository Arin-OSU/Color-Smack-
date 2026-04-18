"use client";
import { Stage } from "@/components/stage/Stage";
import { BottomComposer } from "@/components/composer/BottomComposer";
import { ResponsePanel } from "@/components/panel/ResponsePanel";

export function MainArea({
  onSubmit,
}: {
  onSubmit: (text: string) => Promise<void> | void;
}) {
  return (
    <div className="flex-1 flex min-w-0">
      <section className="flex-1 flex flex-col min-w-0">
        <div className="flex-1 min-h-0">
          <Stage />
        </div>
        <BottomComposer onSubmit={onSubmit} />
      </section>
      <ResponsePanel />
    </div>
  );
}
