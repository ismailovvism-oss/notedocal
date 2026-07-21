import type { ContactMethod } from '../types';
import { CONTACT_META, contactHref } from '../lib/persons';

/** Способы связи персоны в виде кликабельных строк. */
export function ContactLinks({ contacts }: { contacts: ContactMethod[] }) {
  if (!contacts.length) return null;
  return (
    <div className="note-contact">
      {contacts.map((c, i) => {
        const href = contactHref(c);
        const inner = (
          <>
            <span aria-hidden>{CONTACT_META[c.type].icon}</span> {c.value}
            {c.label ? <span className="muted small"> · {c.label}</span> : null}
          </>
        );
        return href ? (
          <a
            key={i}
            className="note-contact-row"
            href={href}
            target={c.type === 'phone' || c.type === 'email' ? undefined : '_blank'}
            rel="noreferrer"
          >
            {inner}
          </a>
        ) : (
          <span key={i} className="note-contact-row">
            {inner}
          </span>
        );
      })}
    </div>
  );
}
