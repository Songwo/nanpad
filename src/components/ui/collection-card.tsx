import { ChevronRight, FolderClosed, FolderOpen, Pencil } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "./button";
import "./collection-card.css";

export function CollectionCard({
  name,
  color,
  count,
  unit,
  description,
  preview,
  openLabel,
  editLabel,
  onOpen,
  onEdit,
}: {
  name: string;
  color: "blue" | "green" | "rose" | "amber";
  count: number;
  unit: string;
  description: string;
  preview?: ReactNode;
  openLabel: string;
  editLabel?: string;
  onOpen: () => void;
  onEdit?: () => void;
}) {
  return (
    <article className={`collection-card collection-card-${color}`} data-empty={count === 0}>
      <button
        type="button"
        className="collection-card-open"
        aria-label={openLabel}
        onClick={onOpen}
      >
        <span className="collection-card-heading">
          <span className="collection-card-emblem" aria-hidden="true">
            <FolderClosed className="collection-icon-closed" />
            <FolderOpen className="collection-icon-open" />
          </span>
          <span className="collection-card-identity">
            <span className="collection-card-title">{name}</span>
            <span className="collection-card-description">{description}</span>
          </span>
          <span className="collection-card-count">
            <strong>{count}</strong>
            <span>{unit}</span>
          </span>
        </span>
        <span className="collection-card-footer">
          <span className="collection-card-preview">{preview}</span>
          <ChevronRight className="collection-card-arrow size-4" aria-hidden="true" />
        </span>
      </button>
      {onEdit && (
        <Button
          variant="ghost"
          size="icon-sm"
          className="collection-card-edit"
          aria-label={editLabel}
          title={editLabel}
          onClick={onEdit}
        >
          <Pencil />
        </Button>
      )}
    </article>
  );
}
