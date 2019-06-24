/**
 * @flow
 */
import path from 'path';
import chalk from 'chalk';
import {logger, inlineString} from '@react-native-community/cli-tools';
import * as ios from '@react-native-community/cli-platform-ios';
import * as android from '@react-native-community/cli-platform-android';
import findDependencies from './findDependencies';
import resolveReactNativePath from './resolveReactNativePath';
import findAssets from './findAssets';
import {
  readConfigFromDisk,
  readDependencyConfigFromDisk,
} from './readConfigFromDisk';
import {type ConfigT} from 'types';
import assign from '../assign';
import merge from '../merge';
import resolveNodeModuleDir from './resolveNodeModuleDir';

function getDependencyConfig(
  root,
  dependencyName,
  finalConfig,
  config,
  userConfig,
  isPlatform,
) {
  return merge(
    {
      root,
      name: dependencyName,
      platforms: Object.keys(finalConfig.platforms).reduce(
        (dependency, platform) => {
          // Linking platforms is not supported
          dependency[platform] = isPlatform
            ? null
            : finalConfig.platforms[platform].dependencyConfig(
                root,
                config.dependency.platforms[platform] || {},
              );
          return dependency;
        },
        {},
      ),
      assets: findAssets(root, config.dependency.assets),
      hooks: config.dependency.hooks,
      params: config.dependency.params,
    },
    userConfig.dependencies[dependencyName] || {},
  );
}

/**
 * Loads CLI configuration
 */
function loadConfig(projectRoot: string = process.cwd()): ConfigT {
  const userConfig = readConfigFromDisk(projectRoot);

  const initialConfig: ConfigT = {
    root: projectRoot,
    get reactNativePath() {
      return userConfig.reactNativePath
        ? path.resolve(projectRoot, userConfig.reactNativePath)
        : resolveReactNativePath(projectRoot);
    },
    dependencies: {},
    commands: userConfig.commands,
    get assets() {
      return findAssets(projectRoot, userConfig.assets);
    },
    platforms: userConfig.platforms,
    haste: {
      providesModuleNodeModules: [],
      platforms: Object.keys(userConfig.platforms),
    },
    get project() {
      const project = {};
      for (const platform in finalConfig.platforms) {
        project[platform] = finalConfig.platforms[platform].projectConfig(
          projectRoot,
          userConfig.project[platform] || {},
        );
      }
      return project;
    },
  };

  const finalConfig = findDependencies(projectRoot).reduce(
    (acc: ConfigT, dependencyName) => {
      let root;
      let config;
      try {
        root = resolveNodeModuleDir(projectRoot, dependencyName);
        config = readDependencyConfigFromDisk(root);
      } catch (error) {
        logger.warn(
          inlineString(`
            Package ${chalk.bold(
              dependencyName,
            )} has been ignored because it contains invalid configuration.

            Reason: ${chalk.dim(error.message)}
          `),
        );
        return acc;
      }

      /**
       * @todo: remove this code once `react-native` is published with
       * `platforms` and `commands` inside `react-native.config.js`.
       */
      if (dependencyName === 'react-native') {
        if (Object.keys(config.platforms).length === 0) {
          config.platforms = {ios, android};
        }
        if (config.commands.length === 0) {
          config.commands = [...ios.commands, ...android.commands];
        }
      }

      const isPlatform = Object.keys(config.platforms).length > 0;

      /**
       * Legacy `rnpm` config required `haste` to be defined. With new config,
       * we do it automatically.
       *
       * @todo: Remove this once `rnpm` config is deprecated and all major RN libs are converted.
       */
      const haste = config.haste || {
        providesModuleNodeModules: isPlatform ? [dependencyName] : [],
        platforms: Object.keys(config.platforms),
      };

      return (assign({}, acc, {
        dependencies: assign({}, acc.dependencies, {
          // $FlowExpectedError: Dynamic getters are not supported
          get [dependencyName]() {
            return getDependencyConfig(
              root,
              dependencyName,
              finalConfig,
              config,
              userConfig,
              isPlatform,
            );
          },
        }),
        commands: [...acc.commands, ...config.commands],
        platforms: {
          ...acc.platforms,
          ...config.platforms,
        },
        haste: {
          providesModuleNodeModules: [
            ...acc.haste.providesModuleNodeModules,
            ...haste.providesModuleNodeModules,
          ],
          platforms: [...acc.haste.platforms, ...haste.platforms],
        },
      }): ConfigT);
    },
    initialConfig,
  );

  return finalConfig;
}

export default loadConfig;
