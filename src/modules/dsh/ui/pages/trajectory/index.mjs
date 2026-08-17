import { getPage, registerPage } from '../registry.mjs'
import { Trajectory } from './Trajectory.jsx'

if (!getPage('trajectory')) {
  registerPage({ id: 'trajectory', title: 'Trajectory', render: Trajectory })
}
