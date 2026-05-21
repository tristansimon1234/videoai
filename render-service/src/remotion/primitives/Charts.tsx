/**
 * Charts namespace — the subset of recharts that mock-code.compiler.ts
 * whitelists. Re-exported under a stable namespace so compiled scenes
 * can call `Remotion.Charts.LineChart` etc.
 */
export {
  ResponsiveContainer,
  LineChart, Line,
  AreaChart, Area,
  BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip,
  PieChart, Pie, Cell,
} from 'recharts'
