import { useEffect, useMemo, useState } from 'react';
import { Dimensions, Pressable, Text, View } from 'react-native';
import {
  api,
  type InsightsCategoryPoint,
  type InsightsMonthPoint,
  type InsightsOverview,
  type LonyScore,
  type User,
} from './api';
import { fonts, radii, space, useTheme } from './theme';
import { PrimaryButton, SecondaryButton } from './ui';

type Season = 'month' | 'year';

type Props = {
  user: User;
  token: string;
  season: Season;
  formatMoney: (amount: string | null | undefined, currency: string | null | undefined, locale?: string) => string;
  onClose: () => void;
};

type Slide = {
  bg: string[];
  eyebrow: string;
  title: string;
  body: string;
  accent?: string;
};

const { width: W, height: H } = Dimensions.get('window');

function pickMonthLabel(series: InsightsMonthPoint[]): string {
  const last = series[series.length - 1]?.month;
  if (!last) return 'This month';
  const [y, m] = last.split('-');
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const mi = Number(m) - 1;
  return `${names[mi] || m} ${y}`;
}

export function SeasonRecapScreen({ user, token, season, formatMoney, onClose }: Props) {
  const { colors } = useTheme();
  const preferred = (user.default_currency_code || 'USD').toUpperCase();
  const [index, setIndex] = useState(0);
  const [overview, setOverview] = useState<InsightsOverview | null>(null);
  const [series, setSeries] = useState<InsightsMonthPoint[]>([]);
  const [categories, setCategories] = useState<InsightsCategoryPoint[]>([]);
  const [score, setScore] = useState<LonyScore | null>(null);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    const months = season === 'year' ? 12 : 1;
    Promise.all([
      api.insightsOverview(token, preferred),
      api.insightsCashflowSeries(token, preferred, season === 'year' ? 12 : 6),
      api.insightsCategories(token, preferred, months),
      api.getScore(token, preferred).catch(() => null),
    ])
      .then(([ov, ser, cats, sc]) => {
        if (cancelled) return;
        setOverview(ov.overview);
        setSeries(ser.series ?? []);
        setCategories(cats.categories ?? []);
        setScore(sc?.score ?? null);
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, preferred, season]);

  const slides: Slide[] = useMemo(() => {
    const year = new Date().getFullYear();
    const yearSeries = series.filter((s) => (s.month || '').startsWith(String(year)));
    const scopeSeries = season === 'year' ? (yearSeries.length ? yearSeries : series) : series.slice(-1);
    const sumIncome = scopeSeries.reduce((a, s) => a + (Number(s.income) || 0), 0);
    const sumExpense = scopeSeries.reduce((a, s) => a + (Number(s.expense) || 0), 0);
    const income = season === 'year' ? sumIncome : Number(overview?.income || sumIncome);
    const expense = season === 'year' ? sumExpense : Number(overview?.expense || sumExpense);
    const net = income - expense;
    const label = season === 'year' ? String(year) : pickMonthLabel(series);
    const topCat = categories[0];
    const savings = income > 0 ? ((income - expense) / income) * 100 : overview?.savings_rate_percent;
    const bestMonth = [...scopeSeries]
      .map((s) => ({
        month: s.month,
        net: (Number(s.income) || 0) - (Number(s.expense) || 0),
      }))
      .sort((a, b) => b.net - a.net)[0];
    const out: Slide[] = [
      {
        bg: ['#0B3D2E', '#1FA97A'],
        eyebrow: season === 'year' ? 'Your year' : 'Your month',
        title: label,
        body:
          season === 'year'
            ? `${scopeSeries.length} months of money stories, rolled into one highlight reel.`
            : 'A colorful look at how money moved through Lony this season.',
        accent: '✦',
      },
      {
        bg: ['#12355B', '#3D8BFF'],
        eyebrow: 'Money in',
        title: formatMoney(String(income), preferred, user.locale),
        body:
          season === 'year'
            ? `Income you tracked across ${scopeSeries.length || 12} months.`
            : overview?.income_mom_percent != null
              ? `${overview.income_mom_percent >= 0 ? 'Up' : 'Down'} ${Math.abs(overview.income_mom_percent).toFixed(0)}% vs last month.`
              : 'Income you tracked and confirmed.',
      },
      {
        bg: ['#4A1C40', '#E85D75'],
        eyebrow: 'Money out',
        title: formatMoney(String(expense), preferred, user.locale),
        body: topCat
          ? `${topCat.category} led spending at ${topCat.share_percent.toFixed(0)}% of the mix.`
          : 'Expenses you logged this season.',
      },
      {
        bg: net >= 0 ? ['#1B4332', '#52B788'] : ['#5C2018', '#E76F51'],
        eyebrow: 'The bottom line',
        title: `${net >= 0 ? '+' : ''}${formatMoney(String(net), preferred, user.locale)}`,
        body:
          savings != null
            ? `Savings rate around ${Number(savings).toFixed(0)}%. ${net >= 0 ? 'You kept more than you spent.' : 'Spending outpaced income — room to tighten.'}`
            : net >= 0
              ? 'You finished ahead this season.'
              : 'A tighter season — next one can rebound.',
      },
    ];
    if (season === 'year' && bestMonth?.month) {
      out.push({
        bg: ['#003049', '#F77F00'],
        eyebrow: 'Peak month',
        title: pickMonthLabel([{ month: bestMonth.month } as InsightsMonthPoint]),
        body: `Your strongest net month was ${formatMoney(String(bestMonth.net), preferred, user.locale)}.`,
      });
    }
    if (categories.length > 1) {
      out.push({
        bg: ['#3D0C11', '#D62828'],
        eyebrow: 'Spending mix',
        title: topCat?.category || 'Categories',
        body: categories
          .slice(0, 3)
          .map((c) => `${c.category} ${c.share_percent.toFixed(0)}%`)
          .join(' · '),
      });
    }
    if (score?.grade) {
      out.push({
        bg: ['#2D1B69', '#7B5CFF'],
        eyebrow: 'Lony Trust',
        title: `Grade ${score.grade}`,
        body: `You’re grade ${score.grade} in Lony Trust${score.thin_history ? ' (still building history)' : ''}. Keep confirming income and paying on time.`,
      });
    }
    out.push({
      bg: ['#14213D', '#FCA311'],
      eyebrow: 'See you next season',
      title: 'Keep going',
      body: 'Open Insights anytime for the full picture — or come back for the next recap.',
      accent: '◆',
    });
    return out;
  }, [overview, series, categories, score, season, preferred, user.locale, formatMoney]);

  const slide = slides[index] || slides[0];
  const progress = slides.map((_, i) => i <= index);

  function next() {
    if (index >= slides.length - 1) onClose();
    else setIndex((i) => i + 1);
  }

  function prev() {
    if (index <= 0) return;
    setIndex((i) => i - 1);
  }

  if (!slide) return null;

  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 2000, width: W, height: H }}>
      <View
        style={{
          flex: 1,
          backgroundColor: slide.bg[0],
          paddingTop: 54,
          paddingHorizontal: space.lg,
          paddingBottom: space.lg,
        }}
      >
        <View style={{ flexDirection: 'row', gap: 4, marginBottom: 16 }}>
          {progress.map((on, i) => (
            <View
              key={i}
              style={{
                flex: 1,
                height: 3,
                borderRadius: 2,
                backgroundColor: on ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.25)',
              }}
            />
          ))}
        </View>

        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={{ color: 'rgba(255,255,255,0.8)', fontFamily: fonts.uiSemi, fontSize: 13 }}>
            Lony · {season === 'year' ? 'Year recap' : 'Month recap'}
          </Text>
          <Pressable onPress={onClose} hitSlop={10}>
            <Text style={{ color: '#fff', fontFamily: fonts.uiSemi, fontSize: 15 }}>Close</Text>
          </Pressable>
        </View>

        <Pressable style={{ flex: 1, justifyContent: 'center', gap: 16 }} onPress={next}>
          <Pressable
            onPress={(e) => {
              e.stopPropagation();
              prev();
            }}
            style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '30%' }}
          />
          <Text style={{ color: 'rgba(255,255,255,0.75)', fontFamily: fonts.uiSemi, fontSize: 14, letterSpacing: 1.2 }}>
            {slide.eyebrow.toUpperCase()}
          </Text>
          {slide.accent ? (
            <Text style={{ color: 'rgba(255,255,255,0.35)', fontFamily: fonts.uiBold, fontSize: 64 }}>{slide.accent}</Text>
          ) : null}
          <Text style={{ color: '#fff', fontFamily: fonts.uiBold, fontSize: 40, lineHeight: 46 }}>{slide.title}</Text>
          <Text style={{ color: 'rgba(255,255,255,0.9)', fontFamily: fonts.ui, fontSize: 17, lineHeight: 26 }}>
            {busy ? 'Loading your season…' : slide.body}
          </Text>
        </Pressable>

        <View style={{ gap: 10 }}>
          <PrimaryButton
            label={index >= slides.length - 1 ? 'Done' : 'Next'}
            onPress={next}
          />
          {index > 0 ? <SecondaryButton label="Back" onPress={prev} /> : null}
        </View>

        {/* Decorative gradient-ish wash */}
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            right: -40,
            bottom: -40,
            width: 220,
            height: 220,
            borderRadius: 110,
            backgroundColor: slide.bg[1] || colors.primary,
            opacity: 0.35,
          }}
        />
      </View>
    </View>
  );
}
