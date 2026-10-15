import type { ReactNode } from 'react';
import { Inbox } from 'lucide-react';

type Props = {
  title: string;
  body?: string;
  icon?: ReactNode;
  action?: ReactNode;
};

export function EmptyState({ title, body, icon, action }: Props) {
  return (
    <div className="empty-state">
      <div className="icon-wrap">{icon ?? <Inbox size={22} />}</div>
      <div className="title">{title}</div>
      {body ? <div className="body">{body}</div> : null}
      {action}
    </div>
  );
}
