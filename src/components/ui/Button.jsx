import Spinner from './Spinner.jsx'

const variantClasses = {
  primary: 'bg-purple-600 hover:bg-purple-500 text-white border border-purple-500 disabled:bg-purple-900 disabled:border-purple-800',
  secondary: 'bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700 disabled:bg-gray-900 disabled:text-gray-600',
  danger: 'bg-red-700 hover:bg-red-600 text-white border border-red-600 disabled:bg-red-900 disabled:border-red-800',
  ghost: 'bg-transparent hover:bg-gray-800 text-gray-300 hover:text-white border border-transparent disabled:text-gray-700',
  success: 'bg-emerald-700 hover:bg-emerald-600 text-white border border-emerald-600 disabled:bg-emerald-900',
}

const sizeClasses = {
  sm: 'px-3 py-1.5 text-sm rounded-md',
  md: 'px-4 py-2 text-sm rounded-lg',
  lg: 'px-6 py-3 text-base rounded-xl',
  xl: 'px-8 py-4 text-lg rounded-xl',
}

export default function Button({
  children,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  onClick,
  className = '',
  type = 'button',
  title,
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      title={title}
      className={`
        inline-flex items-center justify-center gap-2 font-medium
        transition-colors duration-150 cursor-pointer
        disabled:cursor-not-allowed disabled:opacity-60
        focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 focus:ring-offset-gray-950
        ${variantClasses[variant] || variantClasses.primary}
        ${sizeClasses[size] || sizeClasses.md}
        ${className}
      `.trim()}
    >
      {loading && <Spinner size="sm" />}
      {children}
    </button>
  )
}
