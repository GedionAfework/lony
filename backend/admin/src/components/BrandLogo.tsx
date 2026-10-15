import logoUrl from '../assets/lony-logo.png';

type Props = {
  size?: number;
  className?: string;
  alt?: string;
};

export function BrandLogo({ size = 36, className, alt = 'Lony' }: Props) {
  return (
    <img
      src={logoUrl}
      alt={alt}
      width={size}
      height={size}
      className={className}
      style={{
        width: size,
        height: size,
        objectFit: 'contain',
        display: 'block',
        background: 'transparent',
      }}
    />
  );
}
