import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

const buttonVariants = cva(
  'ui-button inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'ui-primary bg-forest text-white hover:opacity-90',
        secondary: 'ui-secondary bg-mint text-forest hover:opacity-90',
        outline: 'ui-outline border border-line bg-surface hover:bg-surface-2',
        ghost: 'ui-ghost hover:bg-surface-2',
        destructive: 'ui-destructive bg-red-700 text-white hover:opacity-90',
      },
      size: { default: 'h-10 px-4 py-2', sm: 'h-9 rounded-md px-3', icon: 'h-9 w-9' },
    },
    defaultVariants: { variant: 'primary', size: 'default' },
  },
);

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, ...props }, ref) => (
  <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
));
Button.displayName = 'Button';
