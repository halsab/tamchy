// @vitest-environment jsdom
import { StrictMode } from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it } from 'vitest';
import strings from '../content/tt.json';
import { App } from './App.tsx';

afterEach(cleanup);

it('показывает название из словаря в минимальном корне', () => {
  render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  expect(
    screen.getByRole('heading', { name: strings.app.name, level: 1 }),
  ).toBeVisible();
  expect(screen.getByRole('main')).toHaveTextContent(strings.app.name);
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});
