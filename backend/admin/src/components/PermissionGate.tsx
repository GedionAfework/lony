import type { ReactNode } from 'react';
import { useAuth } from '../auth';

type Props = {
  perm: string;
  children: ReactNode;
  fallback?: ReactNode;
};

/** Renders children only when the signed-in admin has the given permission code. */
export function PermissionGate({ perm, children, fallback = null }: Props) {
  const { hasPerm } = useAuth();
  if (!hasPerm(perm)) return <>{fallback}</>;
  return <>{children}</>;
}
