import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { format } from 'date-fns';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function safeFormatDate(dateString: string | Date | null | undefined, formatStr: string = 'dd/MM/yyyy'): string {
  if (!dateString) return '';
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return '';
  try {
    return format(date, formatStr);
  } catch (e) {
    return '';
  }
}
