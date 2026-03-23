export default function ProgressBar({ value = 0, label = '', className = '' }) {
  const pct = Math.min(100, Math.max(0, value))

  return (
    <div className={`w-full ${className}`}>
      {label && (
        <div className="flex justify-between items-center mb-1.5">
          <span className="text-sm text-gray-400">{label}</span>
          <span className="text-sm font-mono text-purple-400">{pct.toFixed(0)}%</span>
        </div>
      )}
      <div className="w-full bg-gray-800 rounded-full h-2.5 overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-purple-600 to-purple-400 rounded-full transition-all duration-300 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}
