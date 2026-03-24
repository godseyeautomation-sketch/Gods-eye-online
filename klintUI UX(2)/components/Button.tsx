
import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'icon';
  size?: 'sm' | 'md' | 'lg';
  active?: boolean;
}

export const Button: React.FC<ButtonProps> = ({ 
  children, 
  variant = 'primary', 
  size = 'md', 
  active = false,
  className = '', 
  ...props 
}) => {
  const baseStyles = "inline-flex items-center justify-center rounded-xl font-semibold tracking-tight transition-all duration-200 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed";
  
  const variants = {
    primary: "bg-brand text-bg hover:brightness-110 active:scale-95 shadow-lg shadow-brand/10 hover:shadow-brand/20",
    secondary: "bg-surface border border-border-base text-text-primary hover:border-text-secondary hover:bg-panel",
    ghost: "bg-transparent text-text-secondary hover:text-text-primary hover:bg-black/5 dark:hover:bg-white/5",
    icon: "p-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 text-text-secondary hover:text-text-primary"
  };

  const activeStyles = active ? "bg-black/10 dark:bg-white/10 text-text-primary border-text-primary" : "";

  const sizes = {
    sm: "h-8 px-3 text-xs",
    md: "h-11 px-5 text-sm",
    lg: "h-14 px-8 text-base",
  };

  const combinedClassName = `${baseStyles} ${variants[variant]} ${sizes[size]} ${activeStyles} ${className}`;

  return (
    <button className={combinedClassName} {...props}>
      {children}
    </button>
  );
};
