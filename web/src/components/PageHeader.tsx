import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from './Button';

type Props = {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  back?: boolean;
  right?: ReactNode;
};

export function PageHeader({ title, subtitle, onBack, back, right }: Props) {
  const navigate = useNavigate();
  return (
    <div className="flex-row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
      <div className="flex-row">
        {back ? (
          <Button variant="icon" aria-label="Back" onClick={() => (onBack ? onBack() : navigate(-1))}>
            <ArrowLeft size={17} />
          </Button>
        ) : null}
        <div>
          <h1 className="page-title">{title}</h1>
          {subtitle ? <div className="page-subtitle">{subtitle}</div> : null}
        </div>
      </div>
      {right ? <div className="flex-row">{right}</div> : null}
    </div>
  );
}
