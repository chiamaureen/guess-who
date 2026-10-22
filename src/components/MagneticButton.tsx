import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useMagnetic } from '../hooks/useMagnetic'

type MagneticButtonProps = {
  children: ReactNode
  icon: string
  variant?: 'primary' | 'outline'
} & ({ to: string; disabled?: never } | { to?: never; disabled?: boolean })

export function MagneticButton({ children, icon, variant = 'primary', to, disabled = false }: MagneticButtonProps) {
  const zoneRef = useMagnetic<HTMLSpanElement>(disabled)

  const className = `button button-${variant} magnetic-button`
  const content = <><span className="button-label" data-magnetic-label>{children}</span><span aria-hidden="true">{icon}</span></>

  return <span className="magnetic-zone" ref={zoneRef}>
    {to !== undefined
      ? <Link className={className} to={to} data-magnetic-target>{content}</Link>
      : <button type="submit" className={className} disabled={disabled} data-magnetic-target>{content}</button>}
  </span>
}
