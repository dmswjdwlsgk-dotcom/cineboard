import { useState } from 'react'
import Header from './components/Header.jsx'
import StepNav from './components/StepNav.jsx'
import Step1 from './components/steps/Step1_Script.jsx'
import Step2 from './components/steps/Step2_Style.jsx'
import Step3 from './components/steps/Step3_Bible.jsx'
import Step4 from './components/steps/Step4_Scenes.jsx'
import Step5 from './components/steps/Step5_Shorts.jsx'
import Step6 from './components/steps/Step6_Intro.jsx'
import Step7 from './components/steps/Step7_BGM.jsx'
import Step8 from './components/steps/Step8_SEO.jsx'
import ApiKeyModal from './components/ApiKeyModal.jsx'
import { useAppStore } from './store/useAppStore.js'

const STEPS = [Step1, Step2, Step3, Step4, Step5, Step6, Step7, Step8]

export default function App() {
  const currentStep = useAppStore(s => s.currentStep)
  const [showApiModal, setShowApiModal] = useState(false)

  const StepComponent = STEPS[currentStep - 1] || Step1

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <Header onApiKeyClick={() => setShowApiModal(true)} />
      <StepNav />
      <main className="max-w-7xl mx-auto px-4 py-6">
        <StepComponent />
      </main>
      <ApiKeyModal isOpen={showApiModal} onClose={() => setShowApiModal(false)} />
    </div>
  )
}
