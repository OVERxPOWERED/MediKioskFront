import {
  PatientData,
  IntakeScreen,
  SessionState,
  ValidationResult,
  ValidationError,
} from '../types';
import { backendService } from './backendService';
import { geminiLiveService } from './geminiLiveService';
import { nativeAudioService } from './nativeAudioService';
import { ocrService } from './ocrService';
import {
  validateName,
  validateAge,
  validatePhone,
  validateReason,
  validateDocuments,
  validateVitals,
} from '../utils/validation';

export type IntakeFlowState = SessionState & {
  currentScreen: IntakeScreen;
  patientData: Partial<PatientData>;
  screenHistory: IntakeScreen[];
  isProcessing: boolean;
  error: string | null;
  voiceQueue: string[];
};

export type ScreenTransitionResult = {
  success: boolean;
  nextScreen: IntakeScreen | null;
  error: ValidationError | null;
  requiresVoicePrompt: boolean;
  voicePromptText: string | null;
};

export type IntakeFlowCallbacks = {
  onStateChange: (state: IntakeFlowState) => void;
  onError: (error: Error) => void;
  onScreenTransition: (from: IntakeScreen, to: IntakeScreen) => void;
  onVoicePrompt: (text: string) => void;
  onSessionComplete: (patientData: PatientData) => void;
};

const SCREEN_ORDER: IntakeScreen[] = [
  'WELCOME',
  'NAME',
  'AGE',
  'PHONE',
  'REASON',
  'DOCUMENTS',
  'VITALS',
  'COMPLETION',
];

const SCREEN_VALIDATORS: Record<IntakeScreen, (data: Partial<PatientData>) => ValidationResult> = {
  WELCOME: () => ({ isValid: true, errors: [] }),
  NAME: (data) => validateName(data.fullName ?? ''),
  AGE: (data) => validateAge(data.age ?? 0),
  PHONE: (data) => validatePhone(data.phone ?? ''),
  REASON: (data) => validateReason(data.reasonForVisit ?? ''),
  DOCUMENTS: (data) => validateDocuments(data.documents ?? []),
  VITALS: (data) => validateVitals(data.vitals),
  COMPLETION: () => ({ isValid: true, errors: [] }),
};

const SCREEN_VOICE_PROMPTS: Record<IntakeScreen, string> = {
  WELCOME: 'Welcome to our clinic. Let\'s begin your check-in process.',
  NAME: 'Please state your full name.',
  AGE: 'What is your age?',
  PHONE: 'Please provide your phone number.',
  REASON: 'What is the reason for your visit today?',
  DOCUMENTS: 'Please scan your insurance card and ID.',
  VITALS: 'Let\'s record your vital signs.',
  COMPLETION: 'Your check-in is complete. Thank you!',
};

const STORAGE_KEY = 'intake_session';

export class IntakeFlowService {
  private state: IntakeFlowState;
  private callbacks: IntakeFlowCallbacks;
  private voiceQueueProcessor: NodeJS.Timeout | null = null;
  private isInitialized = false;

  constructor(callbacks: IntakeFlowCallbacks) {
    this.callbacks = callbacks;
    this.state = this.getInitialState();
  }

  private getInitialState(): IntakeFlowState {
    return {
      sessionId: '',
      currentScreen: 'WELCOME',
      patientData: {},
      screenHistory: ['WELCOME'],
      isProcessing: false,
      error: null,
      voiceQueue: [],
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  public async startSession(): Promise<void> {
    if (this.isInitialized) {
      const loaded = await this.loadSession();
      if (loaded) {
        this.emitStateChange();
        await this.playWelcomePrompt();
        return;
      }
    }

    this.state = {
      ...this.getInitialState(),
      sessionId: this.generateSessionId(),
    };
    this.isInitialized = true;
    await this.persistSession();
    this.emitStateChange();
    await this.playWelcomePrompt();
  }

  public async advanceScreen(screenData: Partial<PatientData>): Promise<ScreenTransitionResult> {
    if (this.state.isProcessing) {
      return {
        success: false,
        nextScreen: null,
        error: { field: 'system', message: 'Already processing a transition' },
        requiresVoicePrompt: false,
        voicePromptText: null,
      };
    }

    this.state.isProcessing = true;
    this.state.error = null;
    this.emitStateChange();

    try {
      const currentScreen = this.state.currentScreen;
      const mergedData = { ...this.state.patientData, ...screenData };
      const validation = SCREEN_VALIDATORS[currentScreen](mergedData);

      if (!validation.isValid) {
        const error = validation.errors[0] ?? { field: currentScreen, message: 'Validation failed' };
        this.state.isProcessing = false;
        this.state.error = error.message;
        this.emitStateChange();
        return {
          success: false,
          nextScreen: null,
          error,
          requiresVoicePrompt: false,
          voicePromptText: null,
        };
      }

      this.state.patientData = mergedData;
      this.state.updatedAt = new Date().toISOString();

      const currentIndex = SCREEN_ORDER.indexOf(currentScreen);
      const nextScreen = currentIndex < SCREEN_ORDER.length - 1 ? SCREEN_ORDER[currentIndex + 1] : null;

      if (nextScreen) {
        this.state.currentScreen = nextScreen;
        this.state.screenHistory.push(nextScreen);
        this.callbacks.onScreenTransition(currentScreen, nextScreen);
      }

      await this.persistSession();

      const requiresVoicePrompt = nextScreen !== null && nextScreen !== 'COMPLETION';
      const voicePromptText = requiresVoicePrompt ? SCREEN_VOICE_PROMPTS[nextScreen] : null;

      if (requiresVoicePrompt && voicePromptText) {
        this.enqueueVoicePrompt(voicePromptText);
      }

      this.state.isProcessing = false;
      this.emitStateChange();

      if (nextScreen === 'COMPLETION') {
        await this.submitIntake();
      }

      return {
        success: true,
        nextScreen,
        error: null,
        requiresVoicePrompt,
        voicePromptText,
      };
    } catch (error) {
      this.state.isProcessing = false;
      const err = error instanceof Error ? error : new Error('Unknown error');
      this.state.error = err.message;
      this.callbacks.onError(err);
      this.emitStateChange();
      return {
        success: false,
        nextScreen: null,
        error: { field: 'system', message: err.message },
        requiresVoicePrompt: false,
        voicePromptText: null,
      };
    }
  }

  public async goBack(): Promise<ScreenTransitionResult> {
    if (this.state.isProcessing || this.state.screenHistory.length <= 1) {
      return {
        success: false,
        nextScreen: null,
        error: { field: 'navigation', message: 'Cannot go back from first screen' },
        requiresVoicePrompt: false,
        voicePromptText: null,
      };
    }

    this.state.isProcessing = true;
    this.emitStateChange();

    try {
      const currentScreen = this.state.currentScreen;
      this.state.screenHistory.pop();
      const previousScreen = this.state.screenHistory[this.state.screenHistory.length - 1];
      this.state.currentScreen = previousScreen;
      this.callbacks.onScreenTransition(currentScreen, previousScreen);

      const voicePromptText = SCREEN_VOICE_PROMPTS[previousScreen];
      if (voicePromptText) {
        this.enqueueVoicePrompt(voicePromptText);
      }

      await this.persistSession();
      this.state.isProcessing = false;
      this.emitStateChange();

      return {
        success: true,
        nextScreen: previousScreen,
        error: null,
        requiresVoicePrompt: true,
        voicePromptText,
      };
    } catch (error) {
      this.state.isProcessing = false;
      const err = error instanceof Error ? error : new Error('Navigation failed');
      this.state.error = err.message;
      this.callbacks.onError(err);
      this.emitStateChange();
      return {
        success: false,
        nextScreen: null,
        error: { field: 'navigation', message: err.message },
        requiresVoicePrompt: false,
        voicePromptText: null,
      };
    }
  }

  public async submitIntake(): Promise<void> {
    this.state.isProcessing = true;
    this.emitStateChange();

    try {
      const patientData = this.state.patientData as PatientData;
      const response = await backendService.submitPatientIntake(patientData);
      
      if (!response.success) {
        throw new Error(response.error ?? 'Failed to submit intake');
      }

      this.state.currentScreen = 'COMPLETION';
      await this.persistSession();
      this.callbacks.onSessionComplete(patientData);
      
      const completionPrompt = SCREEN_VOICE_PROMPTS.COMPLETION;
      this.enqueueVoicePrompt(completionPrompt);
    } catch (error) {
      const err = error instanceof Error ? error : new Error('Submission failed');
      this.state.error = err.message;
      this.callbacks.onError(err);
    } finally {
      this.state.isProcessing = false;
      this.emitStateChange();
    }
  }

  public async handleVoiceInput(transcript: string): Promise<void> {
    const currentScreen = this.state.currentScreen;
    let screenData: Partial<PatientData> = {};

    switch (currentScreen) {
      case 'NAME':
        screenData = { fullName: transcript.trim() };
        break;
      case 'AGE':
        const age = parseInt(transcript.replace(/\D/g, ''), 10);
        if (!isNaN(age)) screenData = { age };
        break;
      case 'PHONE':
        screenData = { phone: transcript.replace(/\D/g, '') };
        break;
      case 'REASON':
        screenData = { reasonForVisit: transcript.trim() };
        break;
      default:
        return;
    }

    if (Object.keys(screenData).length > 0) {
      await this.advanceScreen(screenData);
    }
  }

  public async scanDocument(documentType: 'insurance' | 'id'): Promise<void> {
    try {
      const result = await ocrService.scanDocument(documentType);
      if (result.success && result.data) {
        const documents = [...(this.state.patientData.documents ?? []), result.data];
        await this.advanceScreen({ documents });
      } else {
        throw new Error(result.error ?? 'Document scan failed');
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error('Scan failed');
      this.state.error = err.message;
      this.callbacks.onError(err);
      this.emitStateChange();
    }
  }

  private async playWelcomePrompt(): Promise<void> {
    const prompt = SCREEN_VOICE_PROMPTS.WELCOME;
    this.enqueueVoicePrompt(prompt);
    try {
      await nativeAudioService.speak(prompt);
    } catch (error) {
      console.warn('TTS failed for welcome prompt:', error);
    }
  }

  private enqueueVoicePrompt(text: string): void {
    this.state.voiceQueue.push(text);
    this.callbacks.onVoicePrompt(text);
    this.processVoiceQueue();
  }

  private async processVoiceQueue(): Promise<void> {
    if (this.voiceQueueProcessor || this.state.voiceQueue.length === 0) return;

    this.voiceQueueProcessor = setTimeout(async () => {
      this.voiceQueueProcessor = null;
      const text = this.state.voiceQueue.shift();
      if (text) {
        try {
          await nativeAudioService.speak(text);
        } catch (error) {
          console.warn('TTS failed:', error);
        }
      }
      if (this.state.voiceQueue.length > 0) {
        this.processVoiceQueue();
      }
    }, 100);
  }

  private async persistSession(): Promise<void> {
    try {
      const sessionData = {
        ...this.state,
        voiceQueue: [],
      };
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(sessionData));
    } catch (error) {
      console.warn('Failed to persist session:', error);
    }
  }

  private async loadSession(): Promise<boolean> {
    try {
      const stored = sessionStorage.getItem(STORAGE_KEY);
      if (!stored) return false;

      const parsed = JSON.parse(stored) as IntakeFlowState;
      if (!parsed.sessionId || !SCREEN_ORDER.includes(parsed.currentScreen)) {
        return false;
      }

      this.state = {
        ...parsed,
        voiceQueue: [],
        isProcessing: false,
        error: null,
      };
      this.isInitialized = true;
      return true;
    } catch (error) {
      console.warn('Failed to load session:', error);
      return false;
    }
  }

  private generateSessionId(): string {
    return `intake_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }

  private emitStateChange(): void {
    this.callbacks.onStateChange({ ...this.state });
  }

  public getState(): IntakeFlowState {
    return { ...this.state };
  }

  public getCurrentScreen(): IntakeScreen {
    return this.state.currentScreen;
  }

  public getPatientData(): Partial<PatientData> {
    return { ...this.state.patientData };
  }

  public clearSession(): void {
    sessionStorage.removeItem(STORAGE_KEY);
    this.state = this.getInitialState();
    this.isInitialized = false;
    if (this.voiceQueueProcessor) {
      clearTimeout(this.voiceQueueProcessor);
      this.voiceQueueProcessor = null;
    }
    this.emitStateChange();
  }

  public destroy(): void {
    this.clearSession();
    nativeAudioService.stop();
  }
}

export const createIntakeFlowService = (callbacks: IntakeFlowCallbacks): IntakeFlowService => {
  return new IntakeFlowService(callbacks);
};