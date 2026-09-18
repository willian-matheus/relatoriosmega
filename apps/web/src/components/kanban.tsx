"use client";
import { useState } from "react";
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { Opportunity, Stage, stages } from "@mega/contracts";
import {
  ArrowUpRight,
  CalendarDays,
  GripVertical,
  Plus,
  UserRound,
} from "lucide-react";
import { dateLabel, initials, localDate, money } from "@/lib/format";

function Card({
  item,
  onOpen,
  overlay = false,
  disabled = false,
}: {
  item: Opportunity;
  onOpen: () => void;
  overlay?: boolean;
  disabled?: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: item.id,
    disabled: overlay || disabled,
  });
  const ownerIndex = ["Ana Martins", "Bruno Costa", "Camila Lima"].indexOf(
    item.owner,
  );
  const overdue = item.dueDate < localDate() && item.stage !== "won";
  return (
    <article
      ref={setNodeRef}
      className={`deal-card ${isDragging ? "is-dragging" : ""} ${overlay ? "drag-overlay" : ""}`}
    >
      <div className="card-top">
        <span className={`company-logo logo-${item.company.length % 5}`}>
          {initials(item.company)}
        </span>
        <span className={`priority ${item.priority}`}>
          <i />
          {
            ({ high: "Alta", medium: "Média", low: "Baixa" } as const)[
              item.priority
            ]
          }
        </span>
        <button
          className="drag-handle"
          {...attributes}
          {...listeners}
          aria-label={`Arrastar ${item.company}`}
          disabled={disabled}
        >
          <GripVertical size={16} />
        </button>
      </div>
      <button className="card-main" onClick={onOpen}>
        <h3>
          {item.company}
          <ArrowUpRight size={14} />
        </h3>
        <span className="contact-name">
          <UserRound size={12} />
          {item.contact}
        </span>
        <strong className="deal-value">{money(item.value)}</strong>
        <p>{item.notes || "Adicione uma observação para o próximo contato."}</p>
      </button>
      <span className="source-tag">
        <span />
        {item.source}
      </span>
      <div className="card-footer">
        <span className={overdue ? "overdue" : ""}>
          <CalendarDays size={13} />
          {item.stage === "won"
            ? "Concluído"
            : item.dueDate === localDate()
              ? "Hoje"
              : dateLabel(item.dueDate)}
          {overdue && <i />}
        </span>
        <span title={item.owner} className={`avatar avatar-${ownerIndex}`}>
          {initials(item.owner)}
        </span>
      </div>
    </article>
  );
}
function Column({
  stage,
  items,
  onOpen,
  onAdd,
  disabled,
}: {
  stage: (typeof stages)[number];
  items: Opportunity[];
  onOpen: (item: Opportunity) => void;
  onAdd: (stage: Stage) => void;
  disabled: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id, disabled });
  return (
    <section
      ref={setNodeRef}
      className={`kanban-column ${isOver ? "column-over" : ""}`}
      style={{ "--stage-color": stage.color } as React.CSSProperties}
      aria-label={stage.label}
    >
      <header className="column-header">
        <div>
          <span className="stage-dot" />
          <h2>{stage.label}</h2>
          <span className="column-count">{items.length}</span>
          <button
            className="icon-button"
            disabled={disabled}
            aria-label={`Adicionar em ${stage.label}`}
            onClick={() => onAdd(stage.id)}
          >
            <Plus size={15} />
          </button>
        </div>
        <p>
          {money(items.reduce((sum, o) => sum + o.value, 0))}
          <span>valor total</span>
        </p>
      </header>
      <div className="column-cards">
        {items.map((item) => (
          <Card
            key={item.id}
            item={item}
            onOpen={() => onOpen(item)}
            disabled={disabled}
          />
        ))}
        {items.length === 0 && (
          <div className="empty-column">
            Nenhuma oportunidade nesta etapa.
            <br />
            Arraste um cartão ou adicione um novo.
          </div>
        )}
        <button
          className="add-card"
          disabled={disabled}
          onClick={() => onAdd(stage.id)}
        >
          <Plus size={14} />
          Adicionar oportunidade
        </button>
      </div>
    </section>
  );
}
export function Kanban({
  items,
  onOpen,
  onAdd,
  onMove,
  busy,
}: {
  items: Opportunity[];
  onOpen: (item: Opportunity) => void;
  onAdd: (stage: Stage) => void;
  onMove: (id: string, stage: Stage) => void;
  busy: boolean;
}) {
  const [active, setActive] = useState<Opportunity | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );
  function end(event: DragEndEvent) {
    setActive(null);
    const id = event.over?.id;
    const item = items.find((o) => o.id === event.active.id);
    if (item && id && item.stage !== id && stages.some((s) => s.id === id))
      onMove(item.id, id as Stage);
  }
  return (
    <DndContext
      sensors={sensors}
      onDragStart={(event) =>
        setActive(items.find((o) => o.id === event.active.id) || null)
      }
      onDragEnd={end}
      onDragCancel={() => setActive(null)}
      accessibility={{
        screenReaderInstructions: {
          draggable:
            "Pressione espaço para começar a arrastar. Use as setas para mover e espaço para soltar. Você também pode abrir o cartão e alterar a etapa no formulário.",
        },
      }}
    >
      <div className="kanban-board">
        {stages.map((stage) => (
          <Column
            key={stage.id}
            stage={stage}
            items={items.filter((o) => o.stage === stage.id)}
            onOpen={onOpen}
            onAdd={onAdd}
            disabled={busy}
          />
        ))}
      </div>
      <DragOverlay>
        {active && <Card item={active} onOpen={() => {}} overlay />}
      </DragOverlay>
    </DndContext>
  );
}
