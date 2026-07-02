import { cn } from '@/lib/utils';

export const LOGO_URL = '/icon-512.png';

const sizeClasses = {
  sm: 'size-[34px] rounded-[11px]',
  md: 'size-12 rounded-[15px]',
} as const;

type LogoProps = {
  size?: keyof typeof sizeClasses;
  className?: string;
};

export function Logo({ size = 'sm', className }: LogoProps) {
  return (
    <span
      className={cn(
        'grid shrink-0 place-items-center overflow-hidden shadow-[0_8px_24px_rgba(201,151,0,0.2)]',
        sizeClasses[size],
        className,
      )}
    >
      <img src={LOGO_URL} alt="" className="size-full object-contain" />
    </span>
  );
}
