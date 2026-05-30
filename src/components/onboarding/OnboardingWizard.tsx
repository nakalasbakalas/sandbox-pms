import { useOnboarding } from '@/hooks/use-onboarding'
import { PropertyStep } from './steps/PropertyStep'
import { RoomTypesStep } from './steps/RoomTypesStep'
import { RoomsStep } from './steps/RoomsStep'
import { RatesStep } from './steps/RatesStep'
import { AdminUserStep } from './steps/AdminUserStep'
import { ReviewStep } from './steps/ReviewStep'
import { Progress } from '@/components/ui/progress'
import { Button } from '@/components/ui/button'
import { Check } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'

const STEPS = [
  { number: 1, title: 'Property Details', component: PropertyStep },
  { number: 2, title: 'Room Types', component: RoomTypesStep },
  { number: 3, title: 'Rooms', component: RoomsStep },
  { number: 4, title: 'Base Rates', component: RatesStep },
  { number: 5, title: 'Admin User', component: AdminUserStep },
  { number: 6, title: 'Review & Confirm', component: ReviewStep },
]

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function validateCurrentStep(state: ReturnType<typeof useOnboarding>['state']) {
  if (!state) return false

  const { property, roomTypes, rooms, rates, adminUser } = state.data

  switch (state.currentStep) {
    case 1:
      return Boolean(
        property.name.trim() &&
        property.email.trim() &&
        isValidEmail(property.email) &&
        property.phone.trim() &&
        property.country.trim() &&
        property.timeZone.trim() &&
        property.currency.trim() &&
        property.defaultCheckIn &&
        property.defaultCheckOut,
      )
    case 2:
      return roomTypes.length > 0 && roomTypes.every((roomType) =>
        roomType.name.trim() &&
        roomType.baseOccupancy > 0 &&
        roomType.maxOccupancy >= roomType.baseOccupancy,
      )
    case 3:
      return rooms.length > 0
    case 4:
      return rates.length === roomTypes.length && rates.every((rate) => Number(rate.baseRate) > 0)
    case 5:
      return Boolean(
        adminUser.name.trim() &&
        isValidEmail(adminUser.email) &&
        adminUser.password.length >= 12 &&
        adminUser.password === adminUser.confirmPassword,
      )
    default:
      return true
  }
}

function stepValidationMessage(step: number) {
  switch (step) {
    case 1:
      return 'Enter property name, valid email, phone, country, time zone, currency, and default times.'
    case 2:
      return 'Keep at least one room type and confirm occupancy limits.'
    case 3:
      return 'Add at least one real room before continuing.'
    case 4:
      return 'Set a base rate greater than zero for every room type.'
    case 5:
      return 'Create an admin user with a valid email and a password of at least 12 characters.'
    default:
      return ''
  }
}

export function OnboardingWizard() {
  const { state, nextStep, prevStep } = useOnboarding()
  
  if (!state) return null
  
  const currentStepData = STEPS[state.currentStep - 1]
  const StepComponent = currentStepData?.component
  
  const progress = (state.currentStep / STEPS.length) * 100
  const canContinue = validateCurrentStep(state)
  const validationMessage = canContinue ? '' : stepValidationMessage(state.currentStep)

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-4xl">
        <div className="bg-card rounded-lg shadow-xl border border-border overflow-hidden">
          <div className="bg-muted/30 p-8 border-b border-border">
            <div className="mb-6">
              <h1 className="text-3xl font-bold text-foreground mb-2">
                Property Setup
              </h1>
              <p className="text-muted-foreground">
                Configure the live property, rooms, rates, and first administrator account.
              </p>
            </div>

            <div className="flex items-center justify-between mb-4">
              {STEPS.map((step, index) => (
                <div key={step.number} className="flex items-center flex-1">
                  <div className="flex flex-col items-center">
                    <div
                      className={cn(
                        'w-10 h-10 rounded-full flex items-center justify-center font-semibold text-sm transition-all',
                        state.currentStep > step.number &&
                          'bg-primary text-primary-foreground',
                        state.currentStep === step.number &&
                          'bg-primary text-primary-foreground ring-4 ring-primary/20',
                        state.currentStep < step.number &&
                          'bg-muted text-muted-foreground'
                      )}
                    >
                      {state.currentStep > step.number ? (
                        <Check weight="bold" />
                      ) : (
                        step.number
                      )}
                    </div>
                    <span
                      className={cn(
                        'text-xs mt-2 text-center hidden sm:block',
                        state.currentStep >= step.number
                          ? 'text-foreground font-medium'
                          : 'text-muted-foreground'
                      )}
                    >
                      {step.title}
                    </span>
                  </div>
                  {index < STEPS.length - 1 && (
                    <div
                      className={cn(
                        'h-1 flex-1 mx-2 rounded transition-all',
                        state.currentStep > step.number
                          ? 'bg-primary'
                          : 'bg-muted'
                      )}
                    />
                  )}
                </div>
              ))}
            </div>

            <Progress value={progress} className="h-2" />
          </div>

          <div className="p-8">
            <div className="mb-6">
              <h2 className="text-2xl font-bold text-foreground mb-2">
                {currentStepData?.title}
              </h2>
              <p className="text-sm text-muted-foreground">
                Step {state.currentStep} of {STEPS.length}
              </p>
            </div>

            {StepComponent && <StepComponent />}
          </div>

          <div className="px-8 pb-8 flex items-center justify-between gap-4">
            <Button
              variant="outline"
              onClick={prevStep}
              disabled={state.currentStep === 1}
              className="min-w-24"
            >
              Back
            </Button>
            
            <div className="flex items-center gap-2">
              {STEPS.map((step) => (
                <div
                  key={step.number}
                  className={cn(
                    'w-2 h-2 rounded-full transition-all sm:hidden',
                    state.currentStep >= step.number
                      ? 'bg-primary'
                      : 'bg-muted'
                  )}
                />
              ))}
            </div>

            <Button
              onClick={nextStep}
              disabled={state.currentStep === STEPS.length || !canContinue}
              className="min-w-24"
            >
              {state.currentStep === STEPS.length ? 'Complete' : 'Next'}
            </Button>
          </div>

          {validationMessage && (
            <div className="border-t bg-muted/30 px-8 py-3 text-sm text-muted-foreground">
              {validationMessage}
            </div>
          )}
        </div>

        <div className="text-center mt-6 text-sm text-muted-foreground">
          Enter real operational details. No demo guests, bookings, payments, or messages are created.
        </div>
      </div>
    </div>
  )
}
