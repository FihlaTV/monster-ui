define(function(require) {
	var $ = require('jquery'),
		_ = require('lodash'),
		moment = require('moment'),
		monster = require('monster'),
		Papa = require('papaparse'),
		JSZip = require('jszip'),
		FileSaver = require('file-saver');

	var portWizard = {

		// Defines API requests not included in the SDK
		requests: {
			'phonebook.lookupNumbers': {
				apiRoot: monster.config.api.phonebook,
				url: 'lnp/lookup',
				verb: 'POST',
				generateError: false
			}
		},

		// Define the events available for other apps
		subscribe: {
			'common.portWizard.render': 'portWizardRender'
		},

		appFlags: {
			portWizard: {
				attachments: {
					mimeTypes: [
						'application/pdf'
					],
					maxSize: 8
				},
				knownErrors: {
					billUpload: {
						carrier_error_7203: {}
					},
					addNumbers: {
						mixed_number_type: {},
						number_is_being_ported_for_a_different_account: {},
						number_is_on_a_port_request_already: {},
						number_exists_on_the_system_already: {},
						too_few_properties: {
							'numbers': 'addNumbers.list.title' // 'field_key': 'i18n.path'
						}
					},
					portNotify: {
						wrong_format: {
							'notifications.email.send_to': 'portNotify.email.label'
						}
					}
				},
				cardinalDirections: ['N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW']
			}
		},

		/**
		 * Store getter
		 * @param  {Array|String} [path]
		 * @param  {*} [defaultValue]
		 * @return {*}
		 */
		portWizardGet: function(path, defaultValue) {
			var self = this,
				store = ['_store', 'portWizard'];
			return _.get(
				self,
				_.isUndefined(path)
					? store
					: _.flatten([store, _.isString(path) ? path.split('.') : path]),
				defaultValue
			);
		},

		/**
		 * Store setter
		 * @param  {Array|String} [path]
		 * @param  {*} [value]
		 */
		portWizardSet: function(path, value) {
			var self = this,
				hasValue = _.toArray(arguments).length === 2,
				store = ['_store', 'portWizard'];
			_.set(
				self,
				hasValue
					? _.flatten([store, _.isString(path) ? path.split('.') : path])
					: store,
				hasValue ? value : path
			);
		},

		/**
		 * @param  {jQuery} [args.container]
		 * @param  {String} [args.data.accountId]
		 * @param  {String} [args.data.portRequestId]
		 * @param  {Function} [args.globalCallback]
		 */
		portWizardRender: function(args) {
			var self = this,
				accountId = _.get(args, 'data.accountId', self.accountId),
				globalCallback = _.get(args, 'globalCallback', function() {}),
				portRequestId = _.get(args, 'data.portRequestId'),
				i18n = self.i18n.active().commonApp.portWizard,
				i18nSteps = i18n.steps,
				stepNames = [
					'nameAndNumbers',
					'carrierSelection',
					'ownershipConfirmation',
					'requiredDocuments',
					'dateAndNotifications',
					'review'
				],
				$container,
				callback;

			if (args.container instanceof jQuery) {
				$container = args.container;
				callback = globalCallback;
			} else {
				var modal = monster.ui.fullScreenModal(null, {
					inverseBg: true
				});
				$container = $('.core-absolute').find('#' + modal.getId() + ' .modal-content');
				callback = function() {
					modal.close();

					globalCallback();
				};
			}

			self.portWizardSet({
				accountId: accountId,
				globalCallback: callback
			});

			monster.pub('common.navigationWizard.render', {
				thisArg: self,
				controlId: 'port_wizard_control',
				data: {
					nameAndNumbers: {
						numbersToPort: {
							type: 'local'
						}
					}
				},
				container: $container,
				steps: _.map(stepNames, function(stepName) {
					var pascalCasedStepName = _.upperFirst(stepName);

					return {
						label: _.get(i18nSteps, [ stepName, 'label' ]),
						description: _.get(i18nSteps, [ stepName, 'description' ]),
						render: {
							callback: _.get(self, 'portWizard' + pascalCasedStepName + 'Render')
						},
						util: 'portWizard' + pascalCasedStepName + 'Util'
					};
				}),
				title: i18n.title,
				cancel: 'portWizardClose',
				done: 'portWizardSubmit',
				doneButton: i18n.doneButton,
				validateOnStepChange: true,
				askForConfirmationBeforeExit: true
			});
		},

		/**************************************************
		 *                  Wizard steps                  *
		 **************************************************/

		/* NAME AND NUMBERS STEP */

		/**
		 * Render the Name + Numbers step
		 * @param  {Object} args  Wizard args
		 * @param  {Function} callback  Callback to pass the step template to be rendered
		 */
		portWizardNameAndNumbersRender: function(args, callback) {
			var self = this,
				nameAndNumbersData = _.get(args.data, 'nameAndNumbers', {}),
				initTemplate = function() {
					var $template = $(self.getTemplate({
							name: 'step-nameAndNumbers',
							data: {
								data: nameAndNumbersData
							},
							submodule: 'portWizard'
						})),
						$form = $template.find('form');

					monster.ui.validate($form, {
						rules: {
							portRequestName: {
								required: true
							},
							'numbersToPort.numbers': {
								required: true,
								phoneNumber: true,
								normalizer: function(value) {
									return _
										.chain(value)
										.split(',')
										.map(_.trim)
										.reject(_.isEmpty)
										.value();
								}
							}
						},
						messages: {
							'numbersToPort.numbers': {
								phoneNumber: self.i18n.active().commonApp.portWizard.steps.nameAndNumbers.numbersToPort.errors.numbers
							}
						},
						onfocusout: self.portWizardValidateFormField,
						autoScrollOnInvalid: true
					});

					self.portWizardNameAndNumbersBindEvents({
						template: $template
					});

					return $template;
				};

			callback({
				template: initTemplate(),
				callback: self.portWizardScrollToTop
			});
		},

		/**
		 * Utility funcion to validate the Name + Numbers form and extract data
		 * @param  {jQuery} $template  Step template
		 * @param  {Object} args  Wizard's arguments
		 * @param  {Object} args.data  Wizard's data that is shared across steps
		 * @returns  {Object}  Object that contains the updated step data, and if it is valid
		 */
		portWizardNameAndNumbersUtil: function($template, args) {
			var self = this,
				$form = $template.find('form'),
				isValid = monster.ui.valid($form),
				nameAndNumbersData;

			if (isValid) {
				nameAndNumbersData = monster.ui.getFormData($form.get(0));

				// Extract and format numbers
				nameAndNumbersData.numbersToPort.formattedNumbers = _
					.chain(nameAndNumbersData.numbersToPort.numbers)
					.split(',')
					.map(_.trim)
					.reject(_.isEmpty)
					.map(monster.util.getFormatPhoneNumber)
					.uniqBy('e164Number')
					.value();

				nameAndNumbersData.numbersToPort.numbers = _
					.chain(nameAndNumbersData.numbersToPort.formattedNumbers)
					.map('e164Number')
					.join(', ')
					.value();

				// Clean nameAndNumbers data, to avoid keeping old data inadvertently when merging
				// the new data
				delete args.data.nameAndNumbers;
			}

			return {
				valid: isValid,
				data: {
					nameAndNumbers: nameAndNumbersData
				}
			};
		},

		/**
		 * Bind Name + Number step events
		 * @param  {Object} args
		 * @param  {jQuery} args.template  Step template
		*/
		portWizardNameAndNumbersBindEvents: function(args) {
			var self = this,
				$template = args.template,
				$numbersArea = $template.find('#numbers_to_port_numbers'),
				$fileInput = $template.find('#numbers_to_port_file'),
				$fileNameInput = $template.find('#numbers_to_port_filename');

			// Display the open file dialog when clicking any part of the file selector container.
			// The click event handler was set to the container instead of the input and the button
			// individually because the input is disabled, so the click event there is ignored.
			$template
				.find('.file-selector')
					.on('click', function(e) {
						// Check if the event has not been triggered programmatically,
						// to prevent recursion
						if (_.isUndefined(e.originalEvent)) {
							return;
						}

						e.preventDefault();

						$fileInput.trigger('click');
					});

			$fileInput.on('change', function(e) {
				var file = e.target.files[0];

				self.portWizardNameAndNumbersProcessFile({
					file: file,
					fileNameInput: $fileNameInput,
					numbersArea: $numbersArea
				});
			});
		},

		/**
		 * Process the uploaded numbers CSV file
		 * @param  {Object} args
		 * @param  {Object} args.file  File data
		 * @param  {jQuery} args.fileNameInput  Text input that is used to display the uploaded file name
		 * @param  {jQuery} args.numbersArea  Text Area that contains the port request's phone numbers
		 */
		portWizardNameAndNumbersProcessFile: function(args) {
			var self = this,
				file = args.file,
				$fileNameInput = args.fileNameInput,
				$numbersArea = args.numbersArea,
				isValid = file.name.match('.+(.csv)$'),
				invalidMessageTemplate = self.getTemplate({
					name: '!' + self.i18n.active().commonApp.portWizard.steps.nameAndNumbers.numbersToPort.errors.file,
					data: {
						type: file.type
					}
				}),
				callbacks = {
					success: function(results) {
						monster.parallel([
							function(parallelCallback) {
								self.portWizardNameAndNumbersNotifyFileParsingResult(results);

								parallelCallback(null);
							},
							function(parallelCallback) {
								$numbersArea.val(function(i, text) {
									var trimmedText = _.trim(text);

									if (!(_.isEmpty(trimmedText) || _.endsWith(trimmedText, ','))) {
										trimmedText += ', ';
									}

									return trimmedText + _.join(results.numbers, ', ');
								}).focus();

								parallelCallback(null);
							}
						]);
					},
					error: function() {
						monster.ui.toast({
							type: 'error',
							message: self.i18n.active().commonApp.portWizard.steps.nameAndNumbers.numbersToPort.messages.file.parseError
						});
					}
				},
				parseFileArgs = _
					.chain(args)
					.pick('file', 'numbersArea')
					.merge(callbacks)
					.value();

			if (!isValid) {
				monster.ui.toast({
					type: 'error',
					message: invalidMessageTemplate
				});

				return;
			}

			self.portWizardNameAndNumbersParseFile(parseFileArgs);

			$fileNameInput.val(file.name);
		},

		/**
		 * Parses the uploaded CSV file to extract the phone numbers
		 * @param  {Object} args
		 * @param  {Object} args.file  File data
		 * @param  {Function} args.successs  Callback function to be executed once the parsing and
		 *                                   number extraction has been completed successfully
		 * @param  {Function} args.error  Callback function to be executed if the file parsing fails
		 */
		portWizardNameAndNumbersParseFile: function(args) {
			var self = this,
				file = args.file;

			monster.waterfall([
				function(waterfallCallback) {
					Papa.parse(file, {
						header: false,
						skipEmptyLines: true,
						complete: function(results) {
							waterfallCallback(null, results);
						},
						error: function(error) {
							waterfallCallback(error);
						}
					});
				},
				function(results, waterfallCallback) {
					var entries = _.flatten(results.data),
						numbers = _
							.chain(entries)
							.map(_.trim)
							.reject(_.isEmpty)
							.map(monster.util.getFormatPhoneNumber)
							.filter('isValid')
							.map('e164Number')
							.uniq()
							.value(),
						numbersData = {
							entriesCount: entries.length,
							numbersCount: numbers.length,
							numbers: numbers
						};

					waterfallCallback(null, numbersData);
				}
			], function(err, results) {
				if (err) {
					return args.error(err);
				}

				args.success(results);
			});
		},

		/**
		 * Notify the file parsing result through a toast message
		 * @param  {Object} args
		 * @param  {Number} args.entriesCount  Total read entries
		 * @param  {Number} args.numbersCount  Count of valid unique phone numbers found
		 */
		portWizardNameAndNumbersNotifyFileParsingResult: function(args) {
			var self = this,
				messageTypes = [
					{
						type: 'error',
						i18nProp: 'noNumbers'
					},
					{
						type: 'warning',
						i18nProp: 'someNumbers'
					},
					{
						type: 'success',
						i18nProp: 'allNumbers'
					}
				],
				isAnyNumber = args.numbersCount !== 0,
				areAllNumbersValid = isAnyNumber && args.numbersCount === args.entriesCount,
				messageIndex = _.toNumber(isAnyNumber) + _.toNumber(areAllNumbersValid),
				messageData = _.get(messageTypes, messageIndex),
				messageTemplate = monster.util.tryI18n(
					self.i18n.active().commonApp.portWizard.steps.nameAndNumbers.numbersToPort.messages.file,
					messageData.i18nProp
				);

			monster.ui.toast({
				type: messageData.type,
				message: self.getTemplate({
					name: '!' + messageTemplate,
					data: args
				})
			});
		},

		/* CARRIER SELECTION STEP */

		/**
		 * Render the Carrier Selection step
		 * @param  {Object} args  Wizard args
		 * @param  {Function} callback  Callback to pass the step template to be rendered
		 */
		portWizardCarrierSelectionRender: function(args, callback) {
			var self = this,
				portRequestName = _.get(args.data, 'nameAndNumbers.portRequestName'),
				formattedNumbers = _.get(args.data, 'nameAndNumbers.numbersToPort.formattedNumbers'),
				carrierSelectionData = _.get(args.data, 'carrierSelection');

			monster.waterfall([
				function(waterfallCallback) {
					self.portWizardCarrierSelectionGetNumberCarriers({
						formattedNumbers: formattedNumbers,
						success: function(carrierData) {
							waterfallCallback(null, carrierData);
						},
						error: function(errorData) {
							waterfallCallback(errorData);
						}
					});
				},
				function(numbersCarrierData, waterfallCallback) {
					var numbersByLosingCarrier = numbersCarrierData.numbersByLosingCarrier,
						winningCarriers = numbersCarrierData.winningCarriers,
						losingCarriersCount = _.size(numbersByLosingCarrier),
						isSingleLosingCarrier = losingCarriersCount === 1,
						isSingleLosingCarrierUnknown = isSingleLosingCarrier && _.has(numbersByLosingCarrier, 'Unknown'),
						noWinningCarriers = _.isEmpty(winningCarriers),
						errorType = isSingleLosingCarrierUnknown
							? 'unknownLosingCarriers'
							: noWinningCarriers
								? 'noWinningCarriers'
								: isSingleLosingCarrier
									? 'none'
									: 'multipleLosingCarriers',
						shouldDisplaySingleTemplate = errorType === 'none',
						$template = shouldDisplaySingleTemplate
							? self.portWizardCarrierSelectionSingleGetTemplate({
								numbersCarrierData: numbersCarrierData,
								carrierSelectionData: carrierSelectionData
							})
							: self.portWizardCarrierSelectionMultipleGetTemplate({
								portRequestName: portRequestName,
								errorType: errorType,
								numbersByLosingCarrier: numbersByLosingCarrier
							});

					waterfallCallback(null, $template);
				}
			], function(err, $template) {
				var errorMessageKey = _.get(err, 'isPhonebookUnavailable', false)
					? 'phonebookUnavailable'
					: 'lookupNumbersError';

				if (_.isNil(err)) {
					return callback({
						template: $template,
						callback: self.portWizardScrollToTop
					});
				}

				// Phonebook is not available, so go to previous step and notify
				monster.pub('common.navigationWizard.goToStep', {
					stepId: 0
				});

				monster.ui.alert(
					'error',
					monster.util.tryI18n(self.i18n.active().commonApp.portWizard.steps.general.errors, errorMessageKey)
				);
			});
		},

		/**
		 * Utility funcion to validate the Carrier Selection form and extract data
		 * @param  {jQuery} $template  Step template
		 * @param  {Object} args  Wizard's arguments
		 * @param  {Object} args.data  Wizard's data that is shared across steps
		 * @returns  {Object}  Object that contains the updated step data, and if it is valid
		 */
		portWizardCarrierSelectionUtil: function($template, args) {
			var self = this;

			// TODO: Not implemented

			return {
				valid: true
			};
		},

		/**
		 * Get template for Carrier Selection step (multiple losing carriers view)
		 * @param  {Object} args
		 * @param  {String} args.portRequestName  Port request name
		 * @param  {String} args.errorType  Error type for carrier selection
		 * @param  {Object} args.numbersByLosingCarrier  Phone numbers grouped by losing carrier
		 */
		portWizardCarrierSelectionMultipleGetTemplate: function(args) {
			var self = this,
				portRequestName = args.portRequestName,
				errorType = args.errorType,
				numbersByLosingCarrier = args.numbersByLosingCarrier,
				dataTemplate = {
					errorType: errorType,
					numbersByLosingCarrier: _
						.chain(numbersByLosingCarrier)
						.map(function(carrierNumberGroup) {
							return {
								carrier: carrierNumberGroup.carrier,
								numbers: _.map(carrierNumberGroup.numbers, 'e164Number')
							};
						})
						.value(),
					losingCarriersCount: _.size(numbersByLosingCarrier)
				},
				$template = $(self.getTemplate({
					name: 'step-carrierSelection-multiple',
					data: {
						data: dataTemplate
					},
					submodule: 'portWizard'
				}));

			monster.pub('common.navigationWizard.setButtonProps', [
				{
					button: 'next',
					display: false
				},
				{
					button: 'back',
					content: self.i18n.active().commonApp.portWizard.steps.carrierSelection.multipleLosingCarriers.backButton
				}
			]);

			self.portWizardCarrierSelectionMultipleBindEvents({
				portRequestName: portRequestName,
				numbersByLosingCarrier: numbersByLosingCarrier,
				template: $template
			});

			return $template;
		},

		/**
		 * Bind events for Carrier Selection step (multiple losing carriers view)
		 * @param  {Object} args
		 * @param  {String} args.portRequestName  Port request name
		 * @param  {Object} args.numbersByLosingCarrier  Numbers grouped by losing carrier
		 * @param  {jQuery} args.template  Step template
		 */
		portWizardCarrierSelectionMultipleBindEvents: function(args) {
			var self = this,
				portRequestName = args.portRequestName,
				numbersByLosingCarrier = args.numbersByLosingCarrier,
				$template = args.template;

			$template.find('#download_number_files')
				.on('click', function(e) {
					e.preventDefault();

					self.portWizardCarrierSelectionMultipleDownloadNumbers({
						fileName: _.snakeCase(portRequestName) + '.zip',
						numbersByLosingCarrier: numbersByLosingCarrier
					});
				});
		},

		/**
		 * Download phone numbers for multiple losing carriers
		 * @param  {Object} args
		 * @param  {String} args.fileName  Default name of the ZIP file to be generated
		 * @param  {Object} args.numbersByLosingCarrier  Numbers grouped by losing carrier
		 */
		portWizardCarrierSelectionMultipleDownloadNumbers: function(args) {
			var self = this,
				zipFileName = args.fileName,
				numbersByLosingCarrier = args.numbersByLosingCarrier,
				zip = new JSZip(),
				blob;

			_.each(numbersByLosingCarrier, function(carrierNumberGroup) {
				var csvFileName = _.snakeCase(carrierNumberGroup.carrier) + '.csv',
					csvFormattedNumbers = _
						.chain(carrierNumberGroup.numbers)
						.map('e164Number')
						.join('\n')
						.value();

				zip.file(csvFileName, csvFormattedNumbers);
			});

			blob = zip.generate({ type: 'blob' });
			saveAs(blob, zipFileName);
		},

		/**
		 * Get template for Carrier Selection step (single losing carrier view)
		 * @param  {Object} args
		 * @param  {Object} args.numbersCarrierData  Carrier data for the port request phone numbers
		 * @param  {Object} args.carrierSelectionData  Carrier selection step data
		 */
		portWizardCarrierSelectionSingleGetTemplate: function(args) {
			var self = this,
				numbersCarrierData = args.numbersCarrierData,
				carrierSelectionData = args.carrierSelectionData,
				carrierNumberGroup = _.head(numbersCarrierData.numbersByLosingCarrier),
				formattedNumbers = carrierNumberGroup.numbers,
				numbers = _.map(formattedNumbers, 'e164Number'),
				dataTemplate = {
					numbersToPort: {
						numbers: numbers,
						count: _.size(numbers)
					},
					designateWinningCarrier: {
						losingCarrier: carrierNumberGroup.carrier,
						winningCarrier: _.get(carrierSelectionData, 'winningCarrier', ''),
						winningCarrierList: _
							.map(numbersCarrierData.winningCarriers, function(carrierName) {
								return {
									value: carrierName,
									label: _.startCase(carrierName)
								};
							})
					}
				},
				$template = $(self.getTemplate({
					name: 'step-carrierSelection-single',
					data: {
						data: dataTemplate
					},
					submodule: 'portWizard'
				}));

			monster.ui.mask($template.find('.search-query'), 'phoneNumber');

			self.portWizardCarrierSelectionSingleBindEvents({
				formattedNumbers: formattedNumbers,
				template: $template
			});

			// TODO: Form validation

			return $template;
		},

		/**
		 * Bind events for Carrier Selection step (single losing carrier view)
		 * @param  {Object} args
		 * @param  {Array} args.formattedNumbers  Formatted phone numbers data
		 * @param  {jQuery} args.template  Template
		 */
		portWizardCarrierSelectionSingleBindEvents: function(args) {
			var self = this,
				formattedNumbers = args.formattedNumbers,
				$template = args.template,
				numbersShown = _.map(formattedNumbers, 'e164Number'),
				$elements = $template.find('.number-list .number-item'),
				$elementsShown = $elements,
				removeSpaces = _.partialRight(_.replace, /\s/g, ''),
				filterNumberElements = function(filterText) {
					var $elementsToShow = $(),
						$elementsToHide = $elementsShown,
						numbersToShow = _
							.chain(formattedNumbers)
							.filter(function(formattedNumberData) {
								return _
									.chain(formattedNumberData)
									.pick([
										'e164Number',
										'nationalFormat',
										'internationalFormat',
										'userFormat'
									])
									.map(removeSpaces)
									.some(function(formattedNumber) {
										return _.includes(formattedNumber, filterText);
									})
									.value();
							})
							.map('e164Number')
							.value(),
						hiddenElementsCount = 0;

					if (_.isEqual(numbersShown, numbersToShow)) {
						return;
					}

					_.each(numbersToShow, function(number) {
						var $numberItem = $elements.filter('[data-e164="' + number + '"]');
						$elementsToShow = $elementsToShow.add($numberItem);
					});

					numbersShown = numbersToShow;
					$elementsShown = $elementsToShow;

					monster.waterfall([
						function(waterfallCallback) {
							if ($elementsToHide.length === 0) {
								return waterfallCallback(null);
							}
							$elementsToHide.fadeOut(150, function() {
								// The complete callback function is called once per element
								hiddenElementsCount += 1;
								if (hiddenElementsCount < $elementsToHide.length) {
									return;
								}

								waterfallCallback(null);
							});
						}
					], function() {
						if ($elementsToShow.length === 0) {
							return;
						}

						$elementsToShow.fadeIn(150);
					});
				};

			$template
				.find('#numbers_to_port_search_numbers')
					.on('keyup', _.debounce(function() {
						var value = removeSpaces($(this).val());

						filterNumberElements(value);
					}, 350));
		},

		/**
		 * Get the losing and winning carriers for the phone numbers
		 * @param  {Object} args
		 * @param  {String[]} args.formattedNumbers  Formatted phone numbers to look up
		 * @param  {Function} args.success  Success callback
		 * @param  {Function} args.error  Error callback
		 */
		portWizardCarrierSelectionGetNumberCarriers: function(args) {
			var self = this,
				formattedNumbers = args.formattedNumbers;

			monster.waterfall([
				function(waterfallCallback) {
					self.portWizardRequestPhoneNumbersLookup({
						numbers: _.map(formattedNumbers, 'e164Number'),
						success: function(data) {
							waterfallCallback(null, data.numbers);
						},
						error: function(errorData) {
							waterfallCallback(errorData);
						}
					});
				},
				function(numbersData, waterfallCallback) {
					var findCommonCarriers = _.spread(_.intersection),
						numbersByLosingCarrier = _
							.chain(formattedNumbers)
							.groupBy(function(formattedNumber) {
								return _.get(numbersData, [
									formattedNumber.e164Number,
									'losing_carrier',
									'name'
								], 'Unknown');
							})
							.map(function(groupedFormattedNumbers, carrierName) {
								return {
									carrier: carrierName,
									numbers: _.sortBy(groupedFormattedNumbers, 'e164Number')
								};
							})
							.sortBy(function(carrierNumberGroup) {
								// Place the Unknown group at the top
								return carrierNumberGroup.carrier === 'Unknown' ? '' : carrierNumberGroup.carrier;
							})
							.value(),
						winningCarriers = _
							.chain(numbersData)
							.map(function(numberData) {
								return _
									.chain(numberData.carriers)
									.filter('portability')
									.map('name')
									.value();
							})
							.thru(findCommonCarriers)
							.value();

					waterfallCallback(null, {
						numbersByLosingCarrier: numbersByLosingCarrier,
						winningCarriers: winningCarriers
					});
				}
			], function(err, results) {
				if (err) {
					return args.error(err);
				}

				args.success(results);
			});
		},

		/* OWNERSHIP CONFIRMATION STEP */

		/**
		 * Render the Ownership Confirmation step
		 * @param  {Object} args  Wizard args
		 * @param  {Function} callback  Callback to pass the step template to be rendered
		 */
		portWizardOwnershipConfirmationRender: function(args, callback) {
			var self = this;

			// TODO: Not implemented

			callback({
				template: $(''),
				callback: self.portWizardScrollToTop
			});
		},

		/**
		 * Utility funcion to validate the Ownership Confirmation form and extract data
		 * @param  {jQuery} $template  Step template
		 * @param  {Object} args  Wizard's arguments
		 * @param  {Object} args.data  Wizard's data that is shared across steps
		 * @returns  {Object}  Object that contains the updated step data, and if it is valid
		 */
		portWizardOwnershipConfirmationUtil: function($template, args) {
			var self = this;

			// TODO: Not implemented

			return {
				valid: true
			};
		},

		/* REQUIRED DOCUMENTS STEP */

		/**
		 * Render the Required Documents step
		 * @param  {Object} args  Wizard args
		 * @param  {Function} callback  Callback to pass the step template to be rendered
		 */
		portWizardRequiredDocumentsRender: function(args, callback) {
			var self = this;

			// TODO: Not implemented

			callback({
				template: $(''),
				callback: self.portWizardScrollToTop
			});
		},

		/**
		 * Utility funcion to validate the Required Documents form and extract data
		 * @param  {jQuery} $template  Step template
		 * @param  {Object} args  Wizard's arguments
		 * @param  {Object} args.data  Wizard's data that is shared across steps
		 * @returns  {Object}  Object that contains the updated step data, and if it is valid
		 */
		portWizardRequiredDocumentsUtil: function($template, args) {
			var self = this;

			// TODO: Not implemented

			return {
				valid: true
			};
		},

		/* DATE AND NOTIFICATIONS STEP */

		/**
		 * Render the Desired Date + Notifications step
		 * @param  {Object} args  Wizard args
		 * @param  {Function} callback  Callback to pass the step template to be rendered
		 */
		portWizardDateAndNotificationsRender: function(args, callback) {
			var self = this;

			// TODO: Not implemented

			callback({
				template: $(''),
				callback: self.portWizardScrollToTop
			});
		},

		/**
		 * Utility funcion to validate the Desired Date + Notifications form and extract data
		 * @param  {jQuery} $template  Step template
		 * @param  {Object} args  Wizard's arguments
		 * @param  {Object} args.data  Wizard's data that is shared across steps
		 * @returns  {Object}  Object that contains the updated step data, and if it is valid
		 */
		portWizardDateAndNotificationsUtil: function($template, args) {
			var self = this;

			// TODO: Not implemented

			return {
				valid: true
			};
		},

		/* REVIEW */

		/**
		 * Render Review + Confirm step
		 * @param  {Object} args Wizard args
		 * @param  {Object} args.data  Wizard's data that is shared across steps
		 * @param  {Function} callback  Callback to pass the step template to be rendered
		 */
		portWizardReviewRender: function(args, callback) {
			var self = this;

			// TODO: Not implemented

			callback({
				template: $(''),
				callback: self.portWizardScrollToTop
			});
		},

		/**
		 * Utility funcion to extract Review data. Not used, as this is only a review step, so it
		 * does not provide any new data.
		 * @returns  {Object}  Object that contains a `valid` flag value
		 */
		portWizardReviewUtil: function() {
			var self = this;

			// TODO: Not implemented

			return {
				valid: true
			};
		},

		/**************************************************
		 *                 Wizard actions                 *
		 **************************************************/

		/* SUBMIT */

		/**
		 * Submits the current port request
		 * @param  {Object} args  Wizard's arguments
		 * @param  {Object} args.data  Wizard's data that was stored across steps
		 */
		portWizardSubmit: function(args) {
			var self = this,
				globalCallback = self.portWizardGet('globalCallback');

			globalCallback();
		},

		/* CLOSE WIZARD */

		/**
		 * Closes the wizard, by invoking the global callback
		 */
		portWizardClose: function() {
			var self = this,
				globalCallback = self.portWizardGet('globalCallback');

			globalCallback();
		},

		/**************************************************
		 *                  API requests                  *
		 **************************************************/

		/**
		 * Lookups details for a list of numbers
		 * @param  {Object} args
		 * @param  {String[]} args.numbers Phone numbers to look up
		 * @param  {Function} args.success  Success callback
		 * @param  {Function} args.error  Error callback
		 */
		portWizardRequestPhoneNumbersLookup: function(args) {
			var self = this;

			monster.request({
				resource: 'phonebook.lookupNumbers',
				data: {
					data: {
						numbers: args.numbers
					}
				},
				success: function(data) {
					args.success(data.data);
				},
				error: function(data, error, globalHandler) {
					args.error({
						isPhonebookUnavailable: _.includes([0, 500], error.status)
					});
				}
			});
		},

		/**************************************************
		 *               Utility functions                *
		 **************************************************/

		/**
		 * Scroll window to top
		 */
		portWizardScrollToTop: function() {
			window.scrollTo(0, 0);
		},

		/**
		 * Validates a form input field
		 * @param  {Element} element  Input element
		 */
		portWizardValidateFormField: function(element) {
			$(element).valid();
		},

		/*****************************************************************************************
		 *                                    OLD PORT WIZARD                                    *
		 *****************************************************************************************/

		/**************************************************
		 *               Templates rendering              *
		 **************************************************/

		/**
		 * @param  {jQuery} args.container
		 * @param  {Object} args.data.attachments
		 * @param  {Object} args.data.request
		 */
		portWizardRenderPortInfo: function(args) {
			var self = this,
				container = args.container,
				attachments = args.data.attachments,
				portRequest = args.data.request,
				initTemplate = function initTemplate() {
					var template = $(self.getTemplate({
						name: 'portInfo',
						data: {
							request: portRequest
						},
						submodule: 'portWizard'
					}));

					self.portWizardBindPortInfoEvents(template, {
						container: container,
						data: {
							attachments: attachments,
							request: portRequest
						}
					});

					return template;
				};

			monster.ui.insertTemplate(container, function(insertTemplateCallback) {
				insertTemplateCallback(initTemplate(), function() {
					container
						.find('#name')
							.focus();
				});
			});
		},

		/**
		 * @param  {jQuery} args.container
		 * @param  {Object} args.data.attachment
		 * @param  {Object} args.data.request
		 */
		portWizardRenderBillUpload: function(args) {
			var self = this,
				container = args.container,
				request = args.data.request,
				initTemplate = function initTemplate() {
					var template = $(self.getTemplate({
						name: 'billUpload',
						data: {
							request: request
						},
						submodule: 'portWizard'
					}));

					self.portWizardRenderBillUploadAccountVerification(template, args);

					self.portWizardBindBillUploadEvents(template, args);

					return template;
				};

			monster.ui.insertTemplate(container, function(insertTemplateCallback) {
				var fileName = 'bill.pdf';

				monster.waterfall([
					function(callback) {
						if (!_.has(request, ['uploads', fileName])) {
							callback(null);
							return;
						}
						self.portWizardRequestGetAttahcment({
							data: {
								portRequestId: request.id,
								documentName: fileName
							},
							success: function(fileData) {
								_.set(args, 'data.attachments.bill', {
									file: fileData,
									name: fileName
								});

								callback(null);
							}
						});
					}
				], function() {
					insertTemplateCallback(initTemplate());
				});
			});
		},

		/*
		 * @param {jQuery} args.container
		 * @param {Object} args.data.attachments
		 * @param {Object} args.data.request
		 */
		portWizardRenderBillUploadAccountVerification: function(parentTemplate, args) {
			var self = this,
				container = parentTemplate.find('#account_verification'),
				attachments = args.data.attachments,
				portRequest = args.data.request,
				initTemplate = function initTemplate() {
					var template = $(self.getTemplate({
						name: 'billUpload-accountVerification',
						data: formatDataToTemplate(portRequest),
						submodule: 'portWizard'
					}));

					monster.ui.mask(template.find('#btn'), 'phoneNumber');
					monster.ui.renderPDF(attachments.bill.file, template.find('.pdf-container'));

					return template;
				},
				formatDataToTemplate = function formatDataToTemplate(request) {
					return {
						carriers: _.get(monster, 'config.whitelabel.port.carriers'),
						request: _.merge({}, request, {
							bill: {
								btn: _.has(request, 'bill.btn')
									? _.get(monster.util.getFormatPhoneNumber(request.bill.btn), 'e164Number', '')
									: ''
							}
						}),
						cardinalDirections: self.appFlags.portWizard.cardinalDirections,
						selectedPreDir: _.get(request, 'bill.street_pre_dir', ''),
						selectedPostDir: _.get(request, 'bill.street_post_dir', '')
					};
				};

			if (
				_.has(attachments, 'bill.file')
				&& _.get(portRequest, 'ui_flags.validation', false)
			) {
				monster.ui.insertTemplate(container, function(insertTemplateCallback) {
					insertTemplateCallback(initTemplate(), undefined, function() {
						parentTemplate.find('.actions').show();
					});
				});
			} else {
				container.empty();
				parentTemplate.find('.actions').hide();
			}
		},

		/**
		 * @param {jQuery} args.container
		 * @param {Object} args.data.attachments
		 * @param {Object} args.data.request
		 */
		portWizardRenderAddNumbers: function(args) {
			var self = this,
				container = args.container,
				template = $(self.getTemplate({
					name: 'addNumbers',
					data: {
						text1Var: self.i18n.active().portWizard.portInfo.numbersType.label[args.data.request.ui_flags.type]
					},
					submodule: 'portWizard'
				}));

			monster.ui.renderPDF(args.data.attachments.bill.file, template.find('.pdf-container'));

			container
				.fadeOut(function() {
					container
						.empty()
						.append(template)
						.fadeIn(function() {
							container
								.find('#numbers')
									.focus();
						});

					self.portWizardRenderAddNumbersList(args);
					self.portWizardRenderAddNumbersPortion(args);

					if (!args.data.request.numbers.hasOwnProperty(args.data.request.bill.btn) & !_.isEmpty(args.data.request.numbers)) {
						self.portWizardRenderAddNumbersActions(args);
					}

					self.portWizardBindAddNumbersEvents(args);
				});
		},

		/**
		 * @param {jQuery} args.container
		 * @param {Object} args.data.request
		 */
		portWizardRenderAddNumbersList: function(args) {
			var self = this,
				container = args.container,
				dataToTemplate = _.merge(args.data, {
					request: {
						extra: {
							numbers_count: _.keys(args.data.request.numbers).length
						}
					}
				}),
				template = $(self.getTemplate({
					name: 'addNumbers-list',
					data: dataToTemplate,
					submodule: 'portWizard'
				})),
				$listWrapper = container.find('.list-wrapper');

			if ($listWrapper.is(':empty')) {
				$listWrapper
					.hide()
					.append(template)
					.fadeIn();
			} else {
				$listWrapper
					.empty()
					.append(template);
			}

			if (_.isEmpty(args.data.request.numbers)) {
				delete args.data.request.ui_flags.portion;

				container
					.find('.success-wrapper')
						.fadeOut(function() {
							$(this)
								.empty();
						});
			}

			self.portWizardBindAddNumbersListEvents(args);
		},

		/**
		 * @param {jQuery} args.container
		 * @param {Object} args.data.request
		 */
		portWizardRenderAddNumbersPortion: function(args) {
			var self = this,
				request = args.data.request,
				container = args.container,
				template = $(self.getTemplate({
					name: 'addNumbers-portion',
					submodule: 'portWizard'
				}));

			if (request.numbers.hasOwnProperty(request.bill.btn)) {
				template
					.find('.portion-item[data-portion="' + request.ui_flags.portion + '"]')
						.addClass('active');

				if (request.ui_flags.portion === 'full') {
					self.portWizardRenderAddNumbersActions(args);
				} else if (request.ui_flags.portion === 'partial') {
					self.portWizardRenderAddNumbersBtn(args);
					self.portWizardRenderAddNumbersActions(args);
				}

				container
					.find('.portion-wrapper')
						.fadeOut(function() {
							$(this)
								.empty()
								.append(template)
								.fadeIn();

							self.portWizardBindAddNumbersPortionEvents(args);
						});
			}
		},

		/**
		 * @param {jQuery} args.container
		 * @param {Object} args.data.request
		 */
		portWizardRenderAddNumbersBtn: function(args) {
			var self = this,
				container = args.container,
				dataToTemplate = {
					request: args.data.request
				},
				template = $(self.getTemplate({
					name: 'addNumbers-btn',
					data: dataToTemplate,
					submodule: 'portWizard'
				}));

			container
				.find('.btn-wrapper')
					.empty()
					.append(template)
					.slideDown();
		},

		/**
		 * @param {jQuery} args.container
		 * @param {Object} args.data.request
		 */
		portWizardRenderAddNumbersActions: function(args) {
			var self = this,
				container = args.container,
				formType = self.portWizardGetFormType(args.data.request),
				dataToTemplate = {
					request: args.data.request,
					eSignEnabled: false,
					buttons: {
						manual: self.i18n.active().portWizard.addNumbers.buttons.next.manual[formType],
						electronic: self.i18n.active().portWizard.addNumbers.buttons.next.eSign[formType]
					}
				},
				template = $(self.getTemplate({
					name: 'addNumbers-actions',
					data: dataToTemplate,
					submodule: 'portWizard'
				})),
				$successWrapper = container.find('.success-wrapper');

			if ($successWrapper.is(':empty')) {
				$successWrapper
					.hide()
					.append(template)
					.fadeIn();

				self.portWizardBindAddNumbersActionsEvents(args);
			}
		},

		/**
		 * @param {jQuery} args.container
		 * @param {Object} args.data.request
		 */
		portWizardRenderUploadForm: function(args) {
			var self = this,
				data = args.data,
				request = data.request,
				formType = self.portWizardGetFormType(request),
				initTemplate = function initTemplate() {
					var dataToTemplate = {
							request: request,
							type: self.i18n.active().portWizard.formTypes[formType],
							formLink: monster.config.whitelabel.port[formType]
						},
						template = $(self.getTemplate({
							name: 'uploadForm',
							data: dataToTemplate,
							submodule: 'portWizard'
						})),
						todayJsDate = moment().toDate(),
						defaultJsDate = _.has(args.data.request, 'signing_date')
							? monster.util.gregorianToDate(args.data.request.signing_date)
							: todayJsDate,
						actionsTemplate;

					if (request.hasOwnProperty('uploads') && request.uploads.hasOwnProperty('form.pdf')) {
						actionsTemplate = $(self.getTemplate({
							name: 'uploadForm-actions',
							submodule: 'portWizard'
						}));

						template
							.find('.actions')
								.append(actionsTemplate);
					}

					monster.ui.datepicker(template.find('#signing_date'), {
						maxDate: todayJsDate
					}).datepicker('setDate', defaultJsDate);

					self.portWizardBindUploadFormEvents(template, args);

					return template;
				};

			monster.ui.insertTemplate(args.container, function(insertTemplateCallback) {
				insertTemplateCallback(initTemplate());
			});
		},

		/**
		 * @param {jQuery} args.container
		 * @param {Object} args.data.request
		 */
		portWizardRenderSignForm: function(args) {
			var self = this,
				initTemplate = function initTemplate() {
					var formType = self.portWizardGetFormType(args.data.request),
						dataToTemplate = {
							type: self.i18n.active().portWizard.formTypes[formType]
						},
						template = $(self.getTemplate({
							name: 'signForm',
							data: dataToTemplate,
							submodule: 'portWizard'
						}));

					self.portWizardBindSignFormEvents(template, args);

					return template;
				};

			monster.ui.insertTemplate(args.container, function(insertTemplateCallback) {
				insertTemplateCallback(initTemplate());
			});
		},

		/**
		 * @param {jQuery} args.container
		 * @param {Object} args.data.request
		 */
		portWizardRenderPortNotify: function(args) {
			var self = this,
				container = args.container,
				initTemplate = function initTemplate() {
					var template = $(self.getTemplate({
						name: 'portNotify',
						data: {
							request: args.data.request
						},
						submodule: 'portWizard'
					}));

					self.portWizardBindPortNotifyEvents(template, args);

					return template;
				};

			container.fadeOut(function() {
				monster.ui.insertTemplate(container, function(insertTemplateCallback) {
					insertTemplateCallback(initTemplate(), function() {
						container
							.find('#email')
								.focus();
					});
				});
			});
		},

		/**
		 * @param {jQuery} args.container
		 * @param {Object} args.data.request
		 */
		portWizardRenderSubmitPort: function(args) {
			var self = this,
				initTemplate = function initTemplate() {
					var dataToTemplate = {
							request: args.data.request,
							today: new Date()
						},
						template = $(self.getTemplate({
							name: 'portSubmit',
							data: dataToTemplate,
							submodule: 'portWizard'
						}));

					self.portWizardBindPortSubmitEvents(template, args);

					return template;
				};

			monster.ui.insertTemplate(args.container, function(insertTemplateCallback) {
				insertTemplateCallback(initTemplate());
			});
		},

		/**************************************************
		 *                 Events bindings                *
		 **************************************************/

		/**
		 * @param {jQuery} template
		 * @param {Object} args.data.request
		 * @param {Object} args.data.attachments
		 */
		portWizardBindPortInfoEvents: function(template, args) {
			var self = this,
				$form = template.find('#form_port_info');

			monster.ui.validate($form, {
				rules: {
					name: {
						required: true,
						minlength: 1,
						maxlength: 128
					},
					'ui_flags.type': {
						required: true
					}
				}
			});

			template
				.on('click', '.portInfo-success', function(event) {
					if (!monster.ui.valid($form)) {
						return;
					}
					event.preventDefault();

					_.merge(args.data, {
						request: monster.ui.getFormData('form_port_info')
					});

					self.portWizardRenderBillUpload(args);
				});

			template
				.find('.cancel')
					.on('click', function(event) {
						event.preventDefault();

						self.portWizardHelperCancelPort();
					});
		},

		/**
		 * @param  {jQuery} template
		 * @param  {Object} args.data.attachments
		 * @param  {Object} args.data.request
		 */
		portWizardBindBillUploadEvents: function(template, args) {
			var self = this,
				formValidationRules = {
					'bill.name': {
						required: true,
						minlength: 1,
						maxlength: 128
					},
					'bill.street_number': {
						required: true,
						digits: true,
						minlength: 1,
						maxlength: 8
					},
					'bill.street_address': {
						required: true,
						minlength: 1,
						maxlength: 128
					},
					'bill.street_type': {
						required: true,
						minlength: 1,
						maxlength: 128
					},
					'bill.locality': {
						required: true,
						minlength: 1,
						maxlength: 128
					},
					'bill.region': {
						required: true,
						minlength: 2,
						maxlength: 2
					},
					'bill.postal_code': {
						required: true,
						digits: true,
						minlength: 5,
						maxlength: 5
					},
					'bill.account_number': {
						required: true,
						maxlength: 128
					},
					'bill.pin': {
						maxlength: 15
					},
					'bill.btn': {
						required: true,
						maxlength: 20
					}
				};

			template
				.find('#bill_input')
					.fileUpload({
						btnClass: 'monster-button-primary monster-button-small',
						btnText: self.i18n.active().portWizard.fileUpload.button,
						inputOnly: true,
						inputPlaceholder: self.i18n.active().portWizard.fileUpload.placeholder,
						mimeTypes: self.appFlags.portWizard.attachments.mimeTypes,
						maxSize: self.appFlags.portWizard.attachments.maxSize,
						filesList: _.has(args.data.request, ['uploads', 'bill.pdf'])
							? ['bill.pdf']
							: [],
						success: function(results) {
							_.merge(args.data.attachments, {
								bill: results[0]
							});
							self.portWizardRenderBillUploadAccountVerification(template, args);
						},
						error: function(errorsList) {
							self.portWizardFileUploadErrorsHandler(errorsList);
						}
					});

			template
				.find('#validation')
					.on('change', function(event) {
						event.preventDefault();

						var isChecked = $(this).is(':checked');

						_.set(args.data.request, 'ui_flags.validation', isChecked);

						self.portWizardRenderBillUploadAccountVerification(template, args);
					});

			template
				.find('.next')
					.on('click', function(event) {
						event.preventDefault();

						var $form = template.find('#form_account_verification'),
							formData = monster.ui.getFormData('form_account_verification'),
							btn = _.get(monster.util.getFormatPhoneNumber(formData.bill.btn), 'e164Number', '');

						monster.ui.validate($form, {
							rules: formValidationRules
						});

						if (monster.ui.valid($form)) {
							_.merge(args.data.request, {
								ui_flags: formData.ui_flags,
								bill: _.assign(formData.bill, {
									btn: btn
								})
							});

							self.portWizardRenderAddNumbers(args);
						}
					});

			template
				.find('.cancel')
					.on('click', function(event) {
						event.preventDefault();

						self.portWizardHelperCancelPort();
					});
		},

		/**
		 * @param {jQuery} args.container
		 * @param {Object} args.data.request
		 */
		portWizardBindAddNumbersEvents: function(args) {
			var self = this,
				container = args.container;

			container
				.find('.collapse')
					.on('click', function(event) {
						event.preventDefault();

						var $this = $(this);

						$this
							.fadeOut(function() {
								container
									.find('.accordion')
										.slideDown();
							});
					});

			container
				.find('.add-numbers')
					.on('click', function(event) {
						event.preventDefault();

						var $form = container.find('#form_add_numbers'),
							formData = monster.ui.getFormData('form_add_numbers'),
							newNumbers = {},
							phoneNumber,
							errors = [];

						monster.ui.validate($form, {
							rules: {
								numbers: {
									required: true
								}
							}
						});

						if (monster.ui.valid($form)) {
							formData.numbers = formData.numbers.replace(/[\n]/g, ' ');
							formData.numbers = formData.numbers.replace(/[-().]/g, '').split(' ');

							_.each(formData.numbers, function(number) {
								phoneNumber = monster.util.getFormatPhoneNumber(number);

								if (phoneNumber.hasOwnProperty('e164Number')) {
									newNumbers[phoneNumber.e164Number] = {};
								} else {
									errors.push(number);
								}
							});

							_.merge(args, {
								data: {
									request: {
										numbers: newNumbers
									}
								}
							});

							$form
								.find('textarea')
									.val('');

							if (_.isEmpty(errors)) {
								container
									.find('.accordion')
										.slideUp(function() {
											container
												.find('.collapse')
													.fadeIn();
										});
							} else {
								monster.ui.toast({
									type: 'warning',
									message: self.getTemplate({
										name: '!' + self.i18n.active().portWizard.toastr.warning.invalidNumbers,
										data: {
											variable: errors.join(', ')
										}
									})
								});
							}

							self.portWizardRenderAddNumbersList(args);
							self.portWizardRenderAddNumbersPortion(args);

							if (args.data.request.numbers.hasOwnProperty(args.data.request.bill.btn)) {
								container
									.find('.success-wrapper')
										.fadeOut(function() {
											$(this)
												.empty();
										});
							} else {
								self.portWizardRenderAddNumbersActions(args);
							}
						}
					});

			container
				.find('.save')
					.on('click', function(event) {
						event.preventDefault();

						var formData = monster.ui.getFormData('form_new_btn'),
							portion = container.find('.portion-item.active').data('portion');

						_.merge(args, {
							data: {
								request: {
									ui_flags: {
										portion: portion
									},
									bill: {
										new_btn: formData.new_btn
									}
								}
							}
						});

						self.portWizardHelperSavePort(args);
					});

			container
				.find('.cancel')
					.on('click', function(event) {
						event.preventDefault();

						self.portWizardHelperCancelPort();
					});
		},

		/**
		 * @param {jQuery} args.container
		 * @param {Object} args.data.request
		 */
		portWizardBindAddNumbersListEvents: function(args) {
			var self = this,
				container = args.container;

			container
				.find('.remove-number')
					.on('click', function(event) {
						event.preventDefault();

						var $this = $(this),
							$item = $this.parents('.item'),
							number = $item.data('number');

						if (args.data.request.bill.btn === number) {
							container
								.find('.portion-wrapper')
									.slideUp(function() {
										$(this)
											.empty();
									});

							container
								.find('.btn-wrapper')
									.slideUp(function() {
										$(this)
											.empty();
									});

							self.portWizardRenderAddNumbersActions(args);
						}

						delete args.data.request.numbers[number];

						self.portWizardRenderAddNumbersList(args);
					});
		},

		/**
		 * @param {jQuery} args.container
		 */
		portWizardBindAddNumbersPortionEvents: function(args) {
			var self = this,
				container = args.container;

			container
				.find('.portion-item')
					.on('click', function(event) {
						event.preventDefault();

						var $this = $(this),
							portion = $this.data('portion');

						if (!$this.hasClass('active')) {
							$this
								.siblings()
									.removeClass('active');

							$this
								.addClass('active');

							if (portion === 'full') {
								container
									.find('.btn-wrapper')
										.slideUp(function() {
											$(this)
												.empty();
										});
							} else {
								self.portWizardRenderAddNumbersBtn(args);
							}

							self.portWizardRenderAddNumbersActions(args);
						}
					});
		},

		/**
		 * @param {jQuery} args.container
		 */
		portWizardBindAddNumbersActionsEvents: function(args) {
			var self = this,
				container = args.container;

			container
				.find('.next')
					.on('click', function(event) {
						event.preventDefault();

						var sign = $(this).data('sign'),
							$form = container.find('#form_new_btn'),
							formData = monster.ui.getFormData('form_new_btn'),
							portion = container.find('.portion-item.active').data('portion');

						monster.ui.validate($form, {
							rules: {
								new_btn: {
									required: true
								}
							}
						});

						if (monster.ui.valid($form)) {
							_.merge(args, {
								data: {
									request: {
										ui_flags: {
											portion: portion
										},
										bill: {
											new_btn: formData.new_btn
										}
									}
								}
							});

							if (sign === 'manual') {
								self.portWizardRenderUploadForm(args);
							} else {
								self.portWizardRenderSignForm(args);
							}
						}
					});
		},

		/**
		 * @param {jQuery} template
		 * @param {Object} args.data.request
		 */
		portWizardBindUploadFormEvents: function(template, args) {
			var self = this,
				$datepicker = template.find('#signing_date'),
				fileUploadOptions = (function(data) {
					var request = data.request,
						options = {
							btnClass: 'monster-button-primary monster-button-small',
							btnText: self.i18n.active().portWizard.fileUpload.button,
							inputOnly: true,
							inputPlaceholder: self.i18n.active().portWizard.fileUpload.placeholder,
							mimeTypes: self.appFlags.portWizard.attachments.mimeTypes,
							maxSize: self.appFlags.portWizard.attachments.maxSize,
							success: function(results) {
								if (request.hasOwnProperty('id')) {
									if (request.hasOwnProperty('uploads') && request.uploads.hasOwnProperty('form.pdf')) {
										self.portWizardRequestUpdateAttachment({
											data: {
												portRequestId: request.id,
												documentName: 'form.pdf',
												data: results[0].file
											}
										});
									} else {
										self.portWizardRequestCreateAttachment({
											data: {
												portRequestId: request.id,
												documentName: 'form.pdf',
												data: results[0].file
											},
											success: function() {
												if (template.find('.uploadForm-success').length < 1) {
													actionsTemplate = $(self.getTemplate({
														name: 'uploadForm-actions',
														submodule: 'portWizard'
													})).css('display', 'none');

													template
														.find('.actions')
															.append(actionsTemplate);

													template
														.find('.uploadForm-success')
															.fadeIn();
												}
											}
										});
									}
								} else {
									_.merge(args.data, {
										attachments: {
											form: results[0]
										}
									});

									if (template.find('.uploadForm-success').length < 1) {
										actionsTemplate = $(self.getTemplate({
											name: 'uploadForm-actions',
											submodule: 'portWizard'
										})).css('display', 'none');

										template
											.find('.actions')
												.append(actionsTemplate);

										template
											.find('.uploadForm-success')
												.fadeIn();
									}
								}
							},
							error: function(errorsList) {
								self.portWizardFileUploadErrorsHandler(errorsList);
							}
						},
						actionsTemplate;

					if (args.data.request.hasOwnProperty('uploads') && args.data.request.uploads.hasOwnProperty('form.pdf')) {
						options.filesList = [ 'form.pdf' ];
					}

					return options;
				})(args.data);

			template
				.find('#form_input')
					.fileUpload(fileUploadOptions);

			template
				.find('.save')
					.on('click', function(event) {
						event.preventDefault();

						var formData = monster.ui.getFormData('form_upload_document'),
							$form = template.find('#form_upload_document');

						monster.ui.validate($form, {
							rules: {
								signee_name: {
									minlength: 1,
									maxlength: 128
								}
							}
						});

						if (monster.ui.valid($form)) {
							_.merge(args.data.request, formData, {
								signing_date: monster.util.dateToGregorian($datepicker.datepicker('getDate'))
							});

							self.portWizardHelperSavePort(args);
						}
					});

			template
				.on('click', '.uploadForm-success', function(event) {
					event.preventDefault();

					var formData = monster.ui.getFormData('form_upload_document'),
						$form = template.find('#form_upload_document');

					monster.ui.validate($form, {
						rules: {
							signee_name: {
								required: true,
								minlength: 1,
								maxlength: 128
							},
							signing_date: {
								required: true
							}
						}
					});

					if (monster.ui.valid($form)) {
						_.merge(args.data.request, formData, {
							signing_date: monster.util.dateToGregorian($datepicker.datepicker('getDate'))
						});
						self.portWizardRenderPortNotify(args);
					}
				});

			template
				.find('.cancel')
					.on('click', function(event) {
						event.preventDefault();

						self.portWizardHelperCancelPort();
					});
		},

		/**
		 * @param {jQuery} template
		 * @param {Object} args
		 */
		portWizardBindSignFormEvents: function(template, args) {
			var self = this;

			template
				.find('.success')
					.on('click', function(event) {
						event.preventDefault();

						self.portWizardRenderPortNotify(args);
					});

			template
				.find('.cancel')
					.on('click', function(event) {
						event.preventDefault();

						self.portWizardHelperCancelPort();
					});
		},

		/**
		 * @param {jQuery} template
		 * @param {Object} args.data.request
		 */
		portWizardBindPortNotifyEvents: function(template, args) {
			var self = this,
				minDate = monster.util.getBusinessDate(4),
				defaultDate = args.data.request.hasOwnProperty('transfer_date') ? monster.util.gregorianToDate(args.data.request.transfer_date) : minDate;

			monster.ui.datepicker(template.find('#transfer_date'), {
				minDate: minDate,
				beforeShowDay: $.datepicker.noWeekends
			}).datepicker('setDate', defaultDate);

			template
				.find('.next')
					.on('click', function(event) {
						event.preventDefault();

						var action = $(this).data('action'),
							formData = monster.ui.getFormData('form_notify');

						_.merge(args.data.request, formData, {
							transfer_date: monster.util.dateToGregorian(new Date(formData.transfer_date))
						});

						if (action === 'save') {
							self.portWizardHelperSavePort(args);
						} else if (action === 'next') {
							self.portWizardRenderSubmitPort(args);
						}
					});

			template
				.find('.cancel')
					.on('click', function(event) {
						event.preventDefault();

						self.portWizardHelperCancelPort();
					});
		},

		/**
		 * @param {jQuery} template
		 * @param {Object} args
		 */
		portWizardBindPortSubmitEvents: function(template, args) {
			var self = this,
				globalCallback = self.portWizardGet('globalCallback');

			template
				.find('.conditions')
					.on('change', function(event) {
						event.preventDefault();

						var formData = monster.ui.getFormData('form_conditions'),
							disabled = formData.conditions.indexOf(false) > -1;

						template
							.find('.success')
								.prop('disabled', disabled);
					});

			template
				.find('#save')
					.on('click', function(event) {
						event.preventDefault();

						self.portWizardHelperSavePort(args);
					});

			template
				.find('.success')
					.on('click', function(event) {
						event.preventDefault();

						monster.waterfall([
							function(waterfallCallback) {
								self.portWizardHelperSavePort(_.merge({}, args, {
									stopErrorPropagation: true,
									success: function(requestId) {
										waterfallCallback(null, requestId);
									}
								}));
							},
							function(requestId, waterfallCallback) {
								// Add request ID to args object, to know that the request
								// has already been saved at this point
								_.set(args, 'data.request.id', requestId);

								// Update port request state
								self.portWizardRequestUpdateState({
									data: {
										portRequestId: requestId,
										state: 'submitted'
									},
									success: function() {
										waterfallCallback(null);
									},
									error: function(parsedError, groupedErrors) {
										waterfallCallback(groupedErrors);
									}
								});
							}
						], function(groupedErrors) {
							if (!groupedErrors) {
								globalCallback();
								return;
							}

							var processedErrors = self.portWizardProcessKnownErrors(groupedErrors);

							if (processedErrors.failedWizardStep === 'billUpload') {
								self.portWizardRenderBillUpload(args);
							} else if (processedErrors.failedWizardStep === 'addNumbers') {
								self.portWizardRenderAddNumbers(args);
							} else if (processedErrors.failedWizardStep === 'portNotify') {
								self.portWizardRenderPortNotify(args);
							} else {
								self.portWizardRenderPortInfo(args);
							}

							self.portWizardShowErrors(processedErrors);
						});
					});

			template
				.find('.cancel')
					.on('click', function(event) {
						event.preventDefault();

						self.portWizardHelperCancelPort();
					});
		},

		/**************************************************
		 *              Data handling helpers             *
		 **************************************************/

		/**
		 * @param {Object} portData
		 */
		portWizardGetFormType: function(portData) {
			return portData.ui_flags.type === 'local' ? 'loa' : 'resporg';
		},

		/*
		 * @param {Object} errorsList
		 */
		portWizardFileUploadErrorsHandler: function(errorsList) {
			var self = this;

			_.each(errorsList, function(files, type) {
				_.each(files, function(file) {
					if (type === 'mimeTypes') {
						monster.ui.toast({
							type: 'warning',
							message: self.getTemplate({
								name: '!' + self.i18n.active().portWizard.toastr.warning.mimeTypes,
								data: {
									variable: _
										.chain(self.appFlags.portWizard.attachments.mimeTypes)
										.map(function(value) {
											return /[^/]*$/
												.exec(value)[0]
												.toUpperCase();
										})
										.join(', ')
										.value()
								}
							})
						});
					} else if (type === 'size') {
						monster.ui.toast({
							type: 'warning',
							message: self.getTemplate({
								name: '!' + self.i18n.active().portWizard.toastr.warning.size,
								data: {
									variable: self.appFlags.portWizard.attachments.maxSize
								}
							})
						});
					}
				});
			});
		},

		/**
		 * @param  {Function} [args.success]
		 * @param  {Function} [args.error]
		 * @param  {Object} args.data.request
		 * @param  {Boolean} [args.stopErrorPropagation]
		 */
		portWizardHelperSavePort: function(args) {
			var self = this,
				container = self.portWizardGet('container'),
				globalCallback = self.portWizardGet('globalCallback'),
				stopErrorPropagation = _.get(args, 'stopErrorPropagation', false),
				method = _.has(args, 'data.request.id')
					? 'portWizardHelperUpdatePort'
					: 'portWizardHelperCreatePort';

			monster.ui.insertTemplate(container, function() {
				self[method](_.merge({}, args, {
					success: _.isFunction(args.success)
						? args.success
						: globalCallback,
					error: function(parsedError, groupedErrors) {
						var processedErrors = self.portWizardProcessKnownErrors(groupedErrors);

						if (processedErrors.failedWizardStep === 'addNumbers') {
							self.portWizardRenderAddNumbers(args);
						} else if (processedErrors.failedWizardStep === 'portNotify') {
							self.portWizardRenderPortNotify(args);
						} else {
							self.portWizardRenderPortInfo(args);
						}

						self.portWizardShowErrors(processedErrors);

						if (!stopErrorPropagation && _.isFunction(args.error)) {
							args.error(parsedError);
						}
					}
				}));
			}, {
				cssId: 'port_wizard',
				title: self.i18n.active().portWizard.loading.title,
				text: self.i18n.active().portWizard.loading.text
			});
		},

		/**
		 * @param {Function} args.success
		 * @param {Function} args.error
		 * @param {Object} args.data.attachments
		 * @param {Object} args.data.request
		 */
		portWizardHelperCreatePort: function(args) {
			var self = this,
				attachments = args.data.attachments;

			monster.waterfall([
				function(callback) {
					self.portWizardRequestCreatePort({
						data: {
							data: self.portWizardNormalizePortRequestData(args.data.request)
						},
						success: function(portRequest) {
							_.set(args, 'data.request.id', portRequest.id);
							callback(null, portRequest);
						},
						error: function(parsedError, error) {
							callback({
								parsedError: parsedError,
								error: error
							});
						}
					});
				},
				function(portRequest, callback) {
					if (_.isEmpty(attachments)) {
						callback(null, portRequest);
						return;
					}
					monster.series(_.map(attachments, function(attachment, file) {
						return function(seriesCallback) {
							self.portWizardRequestCreateAttachment({
								data: {
									portRequestId: portRequest.id,
									documentName: file + '.pdf',
									data: attachment.file
								},
								success: function() {
									seriesCallback(null);
								},
								error: function() {
									seriesCallback(true);
								}
							});
						};
					}), function(err, results) {
						if (err) {
							callback({});
							return;
						}
						callback(null, portRequest.id);
					});
				}
			], function(err, portRequestId) {
				if (!_.isNull(err)) {
					args.error(err.parsedError, err.error);
					return;
				}
				args.success(portRequestId);
			});
		},

		/**
		 * @param {Function} args.success
		 * @param {Function} args.error
		 * @param {Object} args.data.attachments
		 * @param {Object} args.data.request
		 */
		portWizardHelperUpdatePort: function(args) {
			var self = this,
				attachments = args.data.attachments,
				portRequest = args.data.request;

			monster.series([
				function(callback) {
					self.portWizardRequestUpdatePort({
						data: {
							data: self.portWizardNormalizePortRequestData(portRequest)
						},
						success: function() {
							callback(null);
						},
						error: function(parsedError, error) {
							callback({
								parsedError: parsedError,
								error: error
							});
						}
					});
				},
				function(callback) {
					if (_.isEmpty(attachments)) {
						callback(null);
						return;
					}
					monster.series(_.map(attachments, function(attachment, type) {
						var fileName = type + '.pdf',
							method = _.has(portRequest, ['uploads', fileName])
								? 'portWizardRequestUpdateAttachment'
								: 'portWizardRequestCreateAttachment';

						return function(seriesCallback) {
							self[method]({
								data: {
									portRequestId: portRequest.id,
									documentName: fileName,
									data: attachment.file
								},
								success: function() {
									seriesCallback(null);
								},
								error: function() {
									seriesCallback({});
								}
							});
						};
					}), callback);
				}
			], function(err) {
				if (!_.isNull(err)) {
					args.error(err.parsedError, err.error);
					return;
				}
				args.success(portRequest.id);
			});
		},

		portWizardHelperCancelPort: function() {
			var self = this,
				globalCallback = self.portWizardGet('globalCallback'),
				portRequestId = self.portWizardGet('portRequest.id'),
				portRequestState = self.portWizardGet('portRequest.port_state'),
				deletePortRequest = function(callback) {
					self.portWizardRequestDeletePort({
						data: {
							portRequestId: portRequestId
						},
						success: function() {
							callback(null);
						}
					});
				},
				cancelPortRequest = function(callback) {
					self.portWizardRequestUpdateState({
						data: {
							portRequestId: portRequestId,
							state: 'canceled'
						},
						success: function() {
							callback(null);
						}
					});
				},
				parallelRequests = [];

			if (portRequestState === 'unconfirmed') {
				parallelRequests.push(deletePortRequest);
			} else if (!_.isUndefined(portRequestId)) {
				parallelRequests.push(cancelPortRequest);
			}

			monster.parallel(parallelRequests, function() {
				globalCallback();
			});
		},

		/**
		 * Mutates portRequest to follow API schema
		 * @param  {Object} portRequest Port request to normalize
		 * @return {Object}             Normalized port request
		 */
		portWizardNormalizePortRequestData: function(portRequest) {
			var self = this,
				isPropEmpty = function(path) {
					return _
						.chain(portRequest)
						.get(path)
						.isEmpty()
						.value();
				};

			// Empty value is not found in enumerated list of values for those properties so we
			// delete them to avoid a validation error
			if (isPropEmpty('bill.street_post_dir')) {
				delete portRequest.bill.street_post_dir;
			}
			if (isPropEmpty('bill.street_pre_dir')) {
				delete portRequest.bill.street_pre_dir;
			}

			return portRequest;
		},

		/**************************************************
		 *              Requests declarations             *
		 **************************************************/

		// Port requests endpoints

		/**
		 * @param {Function} args.success
		 * @param {Function} [args.error]
		 * @param {Object} args.data.data
		 */
		portWizardRequestCreatePort: function(args) {
			var self = this;

			self.portWizardRequestSavePort('port.create', args);
		},
		/**
		 * @param  {Function} args.success
		 * @param  {Function} [args.error]
		 */
		portWizardRequestGetPort: function(args) {
			var self = this;

			self.callApi({
				resource: 'port.get',
				data: _.merge({
					accountId: self.portWizardGet('accountId')
				}, args.data),
				success: function(data) {
					args.hasOwnProperty('success') && args.success(data.data);
				},
				error: function(parsedError) {
					args.hasOwnProperty('error') && args.error(parsedError);
				}
			});
		},
		/**
		 * @param {Function} args.success
		 * @param {Function} [args.error]
		 * @param {Object} args.data.data
		 */
		portWizardRequestUpdatePort: function(args) {
			var self = this;

			self.portWizardRequestSavePort('port.update', args);
		},
		portWizardRequestSavePort: function(resource, args) {
			var self = this;

			self.callApi({
				resource: resource,
				data: _.merge({
					accountId: self.portWizardGet('accountId'),
					generateError: false
				}, args.data),
				success: function(data, status) {
					args.hasOwnProperty('success') && args.success(data.data);
				},
				error: function(parsedError, error, globalHandler) {
					var groupedErrors = self.portWizardGroupSavePortErrors(parsedError, error);

					if (groupedErrors) {
						args.hasOwnProperty('error') && args.error(parsedError, groupedErrors);
						return;
					}

					globalHandler(error, {
						generateError: true
					});

					args.hasOwnProperty('error') && args.error(parsedError);
				}
			});
		},
		/**
		 * @param {Function} args.success
		 * @param {Function} [args.error]
		 * @param {String} args.data.portRequestId
		 */
		portWizardRequestDeletePort: function(args) {
			var self = this;

			self.callApi({
				resource: 'port.delete',
				data: _.merge({
					accountId: self.portWizardGet('accountId')
				}, args.data),
				success: function(data, status) {
					args.hasOwnProperty('success') && args.success(data.data);
				},
				error: function(parsedError, error, globalHandler) {
					args.hasOwnProperty('error') && args.error(parsedError);
				}
			});
		},
		/**
		 * @param {Function} args.success
		 * @param {Function} [args.error]
		 * @param {String} args.data.portRequestId
		 * @param {String} args.data.state
		 */
		portWizardRequestUpdateState: function(args) {
			var self = this;

			self.callApi({
				resource: 'port.changeState',
				data: _.merge({
					accountId: self.portWizardGet('accountId'),
					generateError: false
				}, args.data),
				success: function(data, status) {
					args.hasOwnProperty('success') && args.success(data.data);
				},
				error: function(parsedError, error, globalHandler) {
					var groupedErrors = self.portWizardGroupSavePortErrors(parsedError, error);
					if (groupedErrors) {
						_.has(args, 'error') && args.error(parsedError, groupedErrors);
						return;
					}
					globalHandler(error, {
						generateError: true
					});
					args.hasOwnProperty('error') && args.error(parsedError);
				}
			});
		},

		// Attachments endpoints

		/**
		 * @param {Function} args.success
		 * @param {Function} [args.error]
		 * @param {String} args.data.portRequestId
		 * @param {String} args.data.documentName
		 * @param {String} args.data.data
		 */
		portWizardRequestCreateAttachment: function(args) {
			var self = this;

			self.callApi({
				resource: 'port.createAttachment',
				data: _.merge({
					accountId: self.portWizardGet('accountId')
				}, args.data),
				success: function(data, status) {
					args.hasOwnProperty('success') && args.success(data.data);
				},
				error: function(parsedError, error, globalHandler) {
					args.hasOwnProperty('error') && args.error(parsedError);
				}
			});
		},
		/**
		 * @param {Function} args.success
		 * @param {Function} [args.error]
		 * @param {String} args.data.portRequestId
		 * @param {String} args.data.documentName
		 */
		portWizardRequestGetAttahcment: function(args) {
			var self = this;

			self.callApi({
				resource: 'port.getAttachment',
				data: _.merge({
					accountId: self.portWizardGet('accountId')
				}, args.data),
				success: function(data, status) {
					// `data` is a string representation of the PDF in base 64
					args.hasOwnProperty('success') && args.success(data);
				},
				error: function(parsedError, error, globalHandler) {
					args.hasOwnProperty('error') && args.error(parsedError);
				}
			});
		},
		/**
		 * @param {Function} [args.success]
		 * @param {Function} [args.error]
		 * @param {String} args.data.portRequestId
		 * @param {String} args.data.documentName
		 * @param {Object} args.data.data
		 */
		portWizardRequestUpdateAttachment: function(args) {
			var self = this;

			self.callApi({
				resource: 'port.updateAttachment',
				data: _.merge({
					accountId: self.portWizardGet('accountId')
				}, args.data),
				success: function(data, status) {
					args.hasOwnProperty('success') && args.success(data.data);
				},
				error: function(parsedError, error, globalHandler) {
					args.hasOwnProperty('error') && args.error(parsedError);
				}
			});
		},

		/**************************************************
		 *             Error handling helpers             *
		 **************************************************/

		portWizardGroupSavePortErrors: function(parsedError, errorData) {
			if (errorData.status !== 400) {
				// Errors cannot be processed
				return null;
			}

			var self = this,
				groupedErrors = {},
				errorsI18n = self.i18n.active().portWizard.errors;

			if (_.get(parsedError, 'error_format', '') === 'phonebook') {
				_.forEach(parsedError.data, function(fieldError, fieldKey) {
					groupedErrors[fieldKey] = _.pick(fieldError.type, [
						'cause',
						'message'
					]);
				});
			} else {
				_.each(parsedError.data, function(fieldErrors, fieldKey) {
					var isPhoneNumber = _.startsWith(fieldKey, '+');

					if (typeof fieldErrors === 'string') {
						return;
					}

					_.each(fieldErrors, function(errorData, errorDataKey) {
						var errorKey, errorMessage, errorCause;

						try {
							// Separate error data depending on the case
							if (isPhoneNumber) {
								errorCause = errorData.cause || fieldKey;

								if (errorData.hasOwnProperty('message')) {
									errorKey = self.portWizardGetErrorKey(errorData.message);
								} else {
									errorKey = errorDataKey;
								}

								errorMessage = errorsI18n[errorKey];

								if (!errorMessage) {
									if (errorData.hasOwnProperty('message')) {
										errorMessage
											= _.capitalize(errorData.message) + ': {{variable}}';
									} else {
										errorMessage = errorsI18n.unknown_error;
									}
								}
							} else {
								errorKey = errorDataKey;
								errorCause = fieldKey;

								if (errorsI18n.hasOwnProperty(errorDataKey)) {
									errorMessage = errorsI18n[errorDataKey];
								} else if (typeof errorData === 'string' || typeof errorData === 'number') {
									errorMessage = _.capitalize(errorData + '') + ': {{variable}}';
								} else if (errorData.hasOwnProperty('message')) {
									errorMessage = _.capitalize(errorData.message) + ': {{variable}}';
								}
							}
						} catch (err) {
							// In case of exception, skip error entry
							return false;
						}

						// If error group already exists, add cause
						if (groupedErrors.hasOwnProperty(errorKey)) {
							if (errorCause) {
								groupedErrors[errorKey].causes.push(errorCause);
							}
							return;
						}

						// Else add new error group
						groupedErrors[errorKey] = {
							message: errorMessage,
							causes: errorCause ? [ errorCause ] : []
						};
					});
				});
			}

			return _.isEmpty(groupedErrors) ? null : groupedErrors;
		},

		portWizardGetErrorKey: function(errorMessage) {
			var minIndex = _.chain([':', ';', ',', '.'])
				.map(function(separator) {
					return errorMessage.indexOf(separator);
				}).filter(function(index) {
					return index > 0;
				}).min().value();

			return _.snakeCase(errorMessage.slice(0, minIndex));
		},

		portWizardShowErrors: function(processedErrors) {
			var self = this,
				viewErrors = _.map(processedErrors.errorGroups, function(errorGroup) {
					return {
						message: errorGroup.message,
						causes: _.chain(errorGroup.causes).map(function(cause) {
							if (_.startsWith(cause, '+')) {
								return monster.util.formatPhoneNumber(cause);
							}
							return cause;
						}).join(', ').value()
					};
				});

			if (viewErrors.length !== 1) {
				// If there is not exactly one kind of error, show dialog
				monster.ui.alert('error', self.getTemplate({
					name: 'errorDialog',
					data: {
						errors: viewErrors
					},
					submodule: 'portWizard'
				}), undefined, {
					isPersistent: true
				});

				return;
			}

			// Else (there is only one kind of error) show toast
			var error = viewErrors[0];

			monster.ui.toast({
				type: 'error',
				message: self.getTemplate({
					name: '!' + error.message,
					data: {
						variable: error.causes
					}
				}),
				options: {
					timeOut: 10000
				}
			});
		},

		portWizardProcessKnownErrors: function(groupedErrors) {
			var self = this,
				knownErrorSteps = self.appFlags.portWizard.knownErrors,
				failedWizardStep = null;

			// Iterate wizard steps for known errors
			_.each(knownErrorSteps, function(knownErrorStep, knownErrorStepKey) {
				// Iterate error causes within known error step
				_.each(knownErrorStep, function(knownErrorCauses, knownErrorKey) {
					// Then check every error group
					_.each(groupedErrors, function(errorGroup, errorGroupKey) {
						// If the error group key does not match a known error key,
						// then continue with the next group
						if (errorGroupKey !== knownErrorKey) {
							return;
						}

						// If there are not known error causes, the cause does not matter and
						// does not need any further processing, so just set the failed step
						if (_.isEmpty(knownErrorCauses)) {
							if (!failedWizardStep) {
								failedWizardStep = knownErrorStepKey;
							}
							return;
						}

						// Else, check error causes and process any translation if possible
						_.each(errorGroup.causes, function(errorGroupCause, i) {
							// If the cause is not known, skip
							if (!knownErrorCauses.hasOwnProperty(errorGroupCause)) {
								return;
							}

							// Set failed step
							if (!failedWizardStep) {
								failedWizardStep = knownErrorStepKey;
							}

							// Try to get translation for cause
							var i18nPath = knownErrorCauses[errorGroupCause];

							if (!i18nPath) {
								return;
							}

							var newCause = _.get(self.i18n.active().portWizard, i18nPath);

							if (!newCause) {
								return;
							}

							errorGroup.causes[i] = '"' + newCause + '"';
						});
					});
				});
			});

			return {
				failedWizardStep: failedWizardStep,
				errorGroups: groupedErrors
			};
		}
	};

	return portWizard;
});
