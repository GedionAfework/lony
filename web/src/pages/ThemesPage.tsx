import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../lib/theme';
import { PageHeader } from '../components/PageHeader';
import { Card } from '../components/Card';

export function ThemesPage() {
  const { mode, setMode } = useTheme();

  return (
    <div className="page page-narrow">
      <PageHeader title="Themes" subtitle="Pick a look for Lony" />
      <div className="grid grid-2">
        <Card
          tight
          onClick={() => setMode('light')}
          style={{ cursor: 'pointer', border: mode === 'light' ? '2px solid var(--primary)' : undefined, textAlign: 'center', padding: 24 }}
        >
          <Sun size={28} style={{ margin: '0 auto 10px', color: '#F59E0B' }} />
          <div style={{ fontWeight: 700 }}>Light</div>
          <div className="muted" style={{ fontSize: 12 }}>White & slate, teal accents</div>
        </Card>
        <Card
          tight
          onClick={() => setMode('dark')}
          style={{ cursor: 'pointer', border: mode === 'dark' ? '2px solid var(--primary)' : undefined, textAlign: 'center', padding: 24 }}
        >
          <Moon size={28} style={{ margin: '0 auto 10px', color: '#818CF8' }} />
          <div style={{ fontWeight: 700 }}>Dark</div>
          <div className="muted" style={{ fontSize: 12 }}>Deep slate, same teal accents</div>
        </Card>
      </div>
    </div>
  );
}
