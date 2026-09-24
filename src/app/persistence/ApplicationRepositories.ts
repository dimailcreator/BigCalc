import { HistoryStorage } from "../history/HistoryStorage.js";
import { LocalCalculatorStateRepository } from "./LocalCalculatorStateRepository.js";
import { LocalSettingsRepository } from "./LocalSettingsRepository.js";
import type {
  CalculatorStateRepository,
  HistoryRepository,
  SettingsRepository,
  StoragePort
} from "./contracts.js";

export interface ApplicationRepositories {
  readonly settings: SettingsRepository;
  readonly history: HistoryRepository;
  readonly calculatorState: CalculatorStateRepository;
}

export function createApplicationRepositories(storage: StoragePort): ApplicationRepositories {
  return Object.freeze({
    settings: new LocalSettingsRepository(storage),
    history: new HistoryStorage(storage),
    calculatorState: new LocalCalculatorStateRepository(storage)
  });
}

export function createBrowserRepositories(): ApplicationRepositories {
  try {
    return createApplicationRepositories(window.localStorage);
  } catch {
    return createApplicationRepositories({
      getItem() {
        throw new Error("Application storage is unavailable");
      },
      setItem() {
        throw new Error("Application storage is unavailable");
      }
    });
  }
}
