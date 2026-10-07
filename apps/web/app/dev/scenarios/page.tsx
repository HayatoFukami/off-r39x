import { ScenarioPanel } from "../../../src/mock/dev-ui/scenario-panel";

export default function ScenariosPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">モックシナリオ</h1>
      <ScenarioPanel />
    </div>
  );
}
