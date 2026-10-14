/** Recto mark: a page with a folded corner and three set lines. */
export function Mark({ size = 26 }: { size?: number }) {
  return (
    <svg className="mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect x="1" y="1" width="30" height="30" rx="3" fill="var(--blue)" />
      <path className="mark-path" d="M9 6h10l5 5v15H9z" fill="none" stroke="var(--cream)" strokeWidth="2" strokeLinejoin="round" strokeDasharray="120" />
      <path className="mark-path" d="M19 6v5h5" fill="none" stroke="var(--cream)" strokeWidth="2" strokeLinejoin="round" strokeDasharray="120" />
      <path className="mark-path" d="M12.5 15h8M12.5 18.5h8M12.5 22h5" stroke="var(--cream)" strokeWidth="1.6" strokeLinecap="round" strokeDasharray="120" />
    </svg>
  );
}
