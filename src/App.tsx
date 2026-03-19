import { useAppStore } from './store/index.js'
import { HomeScreen } from './components/HomeScreen/index.js'
import { ProjectWorkspace } from './components/ProjectWorkspace/index.js'
import { AuthGate } from './components/auth/AuthGate.js'

export default function App() {
  const currentView = useAppStore(s => s.currentView)
  return (
    <AuthGate>
      {currentView === 'home' ? <HomeScreen /> : <ProjectWorkspace />}
    </AuthGate>
  )
}
