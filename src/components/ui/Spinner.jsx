const sizeClasses = {
  sm: 'w-4 h-4 border-2',
  md: 'w-6 h-6 border-2',
  lg: 'w-10 h-10 border-4',
  xl: 'w-16 h-16 border-4',
}

export default function Spinner({ size = 'md', className = '' }) {
  return (
    <div
      className={`
        ${sizeClasses[size] || sizeClasses.md}
        border-gray-600 border-t-purple-500
        rounded-full animate-spin flex-shrink-0
        ${className}
      `.trim()}
    />
  )
}
