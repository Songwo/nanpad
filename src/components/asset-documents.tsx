import { useEffect, useMemo } from "react";
import { Plus, FileText } from "lucide-react";
import { toast } from "sonner";
import { useDocuments } from "@/lib/documents";
import { refKey, type AssetRef } from "@/lib/operations";
import { useAppStore } from "@/lib/store";
import { Button } from "./ui/button";
import { t } from "@/lib/i18n";
const fail = (e: unknown) => toast.error(String(e));
export function AssetDocuments({ asset }: { asset: AssetRef }) {
  const list = useDocuments((s) => s.list);
  const load = useDocuments((s) => s.load);
  useEffect(() => {
    void load().catch(fail);
  }, [load]);
  const bound = useMemo(
    () => list.filter((doc) => doc.bindings.some((ref) => refKey(ref) === refKey(asset))),
    [list, asset],
  );
  async function enter(id?: string) {
    try {
      if (id) await useDocuments.getState().open(id);
      else await useDocuments.getState().create([{ kind: asset.kind, id: asset.id }]);
      useAppStore.getState().setExpanded(null);
      useAppStore.getState().setView("docs");
    } catch (e) {
      fail(e);
    }
  }
  return (
    <section className="border-t border-line p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">
          {t("关联文档")} · {bound.length}
        </h3>
        <Button size="sm" variant="outline" onClick={() => void enter()}>
          <Plus />
          {t("新建文档")}
        </Button>
      </div>
      {bound.map((doc) => (
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-md p-2 text-left text-sm hover:bg-line"
          key={doc.id}
          onClick={() => void enter(doc.id)}
        >
          <FileText className="size-4" />
          {doc.title}
        </button>
      ))}
      {!bound.length && (
        <p className="text-xs text-muted">{t("还没有关联文档，可新建图文笔记。")}</p>
      )}
    </section>
  );
}
