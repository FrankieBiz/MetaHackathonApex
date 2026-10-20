import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  Check,
  ChevronDown,
  GripVertical,
  MoreHorizontal,
  X,
  EyeOff,
  ChevronUp,
  ArrowUpRight,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Category, WidgetId } from "../types";
import { useWorkspace } from "../store";
import { useState } from "react";
export const categoryColor: Record<Category, string> = {
  Software: "emerald",
  Academics: "violet",
  Finance: "cyan",
  Athletics: "amber",
  Personal: "blue",
};
export function Badge({
  children,
  color = "muted",
  dot = false,
}: {
  children: ReactNode;
  color?: string;
  dot?: boolean;
}) {
  return (
    <span className={`badge ${color}`}>
      {dot && <span className="badge-dot" />}
      {children}
    </span>
  );
}
export function Progress({
  value,
  color = "emerald",
}: {
  value: number;
  color?: string;
}) {
  const reduceMotion = useReducedMotion();
  return (
    <div
      className={`progress-track ${color}`}
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <motion.div
        className="progress-fill"
        initial={false}
        animate={{ width: `${value}%` }}
        transition={{ duration: reduceMotion ? 0 : 0.35, ease: "easeOut" }}
      />
    </div>
  );
}
export function CheckButton({
  checked,
  onClick,
  label,
}: {
  checked: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      className={`check-button ${checked ? "checked" : ""}`}
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          onClick();
        }
      }}
    >
      {checked && <Check size={11} strokeWidth={3} />}
    </button>
  );
}
export function Widget({
  id,
  icon: Icon,
  title,
  suffix,
  children,
}: {
  id: WidgetId;
  icon: LucideIcon;
  title: string;
  suffix?: ReactNode;
  children: ReactNode;
}) {
  const collapsed = useWorkspace((s) => s.collapsed.includes(id));
  const toggleCollapse = useWorkspace((s) => s.toggleCollapse);
  const toggleWidget = useWorkspace((s) => s.toggleWidget);
  const locked = useWorkspace((s) => s.locked);
  const [menu, setMenu] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menu]);
  return (
    <section
      className={`widget ${collapsed ? "is-collapsed" : ""}`}
      aria-label={title}
    >
      <header className={`widget-header ${locked ? "" : "draggable"}`}>
        <div className="widget-heading">
          {!locked && <GripVertical size={13} className="drag-grip" />}
          <Icon size={16} />
          <h2>{title}</h2>
          {suffix}
        </div>
        <div className="widget-actions" ref={ref}>
          <button
            className="icon-button collapse-control"
            title={collapsed ? `Expand ${title}` : `Collapse ${title}`}
            aria-label={collapsed ? `Expand ${title}` : `Collapse ${title}`}
            onClick={() => toggleCollapse(id)}
          >
            {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </button>
          <button
            className="icon-button"
            aria-label={`${title} options`}
            onClick={() => setMenu(!menu)}
          >
            <MoreHorizontal size={18} />
          </button>
          {menu && (
            <div className="popover widget-menu">
              <button
                onClick={() => {
                  toggleCollapse(id);
                  setMenu(false);
                }}
              >
                {collapsed ? (
                  <ChevronDown size={14} />
                ) : (
                  <ChevronUp size={14} />
                )}
                {collapsed ? "Expand module" : "Collapse module"}
              </button>
              <button
                onClick={() => {
                  toggleWidget(id);
                  setMenu(false);
                }}
              >
                <EyeOff size={14} />
                Hide module
              </button>
            </div>
          )}
        </div>
      </header>
      {!collapsed && <div className="widget-body">{children}</div>}
    </section>
  );
}
export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const reduceMotion = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    (
      ref.current?.querySelector<HTMLElement>(
        "input:not([type=file]), textarea, select",
      ) ?? ref.current?.querySelector<HTMLElement>("button")
    )?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
      if (e.key !== "Tab") return;
      const items = ref.current?.querySelectorAll<HTMLElement>(
        "button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href]",
      );
      if (!items?.length) return;
      const first = items[0],
        last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, []);
  return createPortal(
    <AnimatePresence>
      <motion.div
        className="modal-backdrop"
        initial={reduceMotion ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: reduceMotion ? 0 : 0.18 }}
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <motion.div
          ref={ref}
          role="dialog"
          aria-modal="true"
          aria-label={title}
          className={`modal ${wide ? "wide" : ""}`}
          initial={reduceMotion ? false : { opacity: 0, y: 8, scale: 0.99 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: reduceMotion ? 0 : 0.2 }}
        >
          <header className="modal-header">
            <h2>{title}</h2>
            <button
              className="icon-button"
              aria-label="Close dialog"
              onClick={onClose}
            >
              <X size={18} />
            </button>
          </header>
          {children}
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body,
  );
}
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <Icon size={24} />
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function TextLink({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button className="text-link" onClick={onClick}>
      {children}
      <ArrowUpRight size={13} />
    </button>
  );
}
