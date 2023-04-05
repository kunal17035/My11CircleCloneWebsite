// Common File to be used in service worker as well as app context for
// sending taxonomy events
var POST_URL = 'https://click.rummycircle.com/trackdata';
var EventWorker = (function() {
  const DB_VERSION = 3;
  const ANALYTICS_DB_NAME = 'analytics-clicktracking'; // DATABASE NAME
  const STORE_NAME = 'events'; // COLLECTION NAME
  const KEY_PATH = 'trackingKey';
  const KEY_PREFIX = 'tagManager_queue_';
  // const MAX_EVENT_COUNT = 1000;

  const MAX_RETRY = 5;

  const ewlogger = {
    log: (label, data) => {
      // console.log(`eventWorker>>> ${label}::`, data);
    },
    error: (label, data) => {
      // console.error(`eventWorker>>> ${label}::`, data);
    },
  };

  /**
   * Singleton Wrapper class over Index DB that opens connection and
   * maintains data
   *
   * @class IDXWrapper
   */

  function IDXWrapper() {
    this.openRequest = null;
    this.tempStore = {};
    this.eventCount = 0;

    /**
     *Creates an instance of IDXWrapper.
     * open index db connection and create object store in not already
     * created
     * @memberof IDXWrapper
     */
    try {
      this.openRequest = indexedDB.open(ANALYTICS_DB_NAME, DB_VERSION);

      this.openRequest.onupgradeneeded = () => {
        ewlogger.log('DB onupgradeneeded');
        // triggers if the client had no database
        // ...perform initialization...
        let db = this.openRequest.result;
        ewlogger.log(
          'DB OBJECT',
          db.objectStoreNames.contains(STORE_NAME, {keyPath: KEY_PATH}),
        );
        if (!db.objectStoreNames.contains(STORE_NAME, {keyPath: KEY_PATH})) {
          ewlogger.log('STORE created');
          // if there's no "events" store
          db.createObjectStore(STORE_NAME, {keyPath: KEY_PATH}); // create it
        }
      };

      this.openRequest.onerror = () => {
        ewlogger.error('DB onerror', this.openRequest.error);
      };

      this.openRequest.onsuccess = () => {
        ewlogger.log('DB onsuccess');
        var db = this.openRequest.result;

        var objectStore = db.transaction(STORE_NAME).objectStore(STORE_NAME);

        var itemCount = objectStore.count();

        itemCount.onsuccess = () => {
          this.eventCount = itemCount.result;
        };
        // continue to work with database using db object
        db.onversionchange = function() {
          db.close();
          ewlogger.log('Database is outdated, please reload the page.');
        };
      };
    } catch (error) {
      ewlogger.log('indexDB connection:: error', error);
    }

    /**
     * Retry adding old events
     *
     * @memberof IDXWrapper
     */
    this.retryAddingOldEvents = () => {
      ewlogger.log('retryAddingOldEvents', {tempStore: this.tempStore});
      if (
        typeof this.tempStore === 'object' &&
        Object.keys(this.tempStore).length > 0
      ) {
        try {
          let db = this.openRequest.result;
          const tempKeys = Object.keys(this.tempStore);
          tempKeys.forEach(key => {
            const eventData = this.tempStore[key];

            let transaction = db.transaction(STORE_NAME, 'readwrite');

            let eventStore = transaction.objectStore(STORE_NAME);

            let request = eventStore.add(eventData);

            // delete from temp store, add again if writing to DB fails
            delete this.tempStore[key];

            request.onerror = () => {
              ewlogger.log('retry failed', request.error);
              // add to temp store again
              this.tempStore[key] = eventData;
            };

            request.onsuccess = () => {
              ewlogger.log('Retry Event data added to store', request.result);
              this.eventCount++;
            };
          });
        } catch (error) {
          ewlogger.log('retryAddingOldEvents:: error', error);
        }
      }
    };

    /**
     * add new data to idx db
     *
     * @memberof IDXWrapper
     */
    this.add = (data, key) => {
      const trackingKey =
        key || KEY_PREFIX + Date.now() + '_' + Number(Math.random()).toFixed(2);
      const eventData = {trackingKey, data};
      ewlogger.log('add data to DB', {data});
      try {
        let db = this.openRequest.result;
        this.retryAddingOldEvents();
        let transaction = db.transaction(STORE_NAME, 'readwrite');

        let eventStore = transaction.objectStore(STORE_NAME);

        let request = eventStore.add(eventData);

        request.onerror = () => {
          ewlogger.log('add error - ', request.error);
          this.tempStore[trackingKey] = eventData;
        };

        request.onsuccess = () => {
          ewlogger.log('Event data added to store', request.result);
          this.eventCount++;
        };
      } catch (error) {
        ewlogger.log('DB add error::', {error, tempStore: this.tempStore});
        this.tempStore[trackingKey] = eventData;
      }
    };

    /**
     * get all data from idx db
     *
     * @memberof IDXWrapper
     */
    this.getAllData = () => {
      let db = this.openRequest && this.openRequest.result;

      if (db) {
        return new Promise((resolve, reject) => {
          try {
            let transaction = db.transaction(STORE_NAME, 'readwrite');

            let eventStore = transaction.objectStore(STORE_NAME);

            let request = eventStore.getAll();

            request.onerror = () => {
              ewlogger.log('get all data error - ', request.error);
              reject(request.error);
            };

            request.onsuccess = () => {
              ewlogger.log('all data from db', request.result);
              resolve(request.result);
            };
          } catch (err) {
            reject(err);
          }
        });
      }
      return new Promise((resolve, reject) => {
        reject('DB Not initialised');
      });
    };

    /**
     * delete data from idx db
     *
     * @memberof IDXWrapper
     */
    this.delete = trackingKey => {
      //TODO:
      let db = this.openRequest && this.openRequest.result;
      if (db) {
        let transaction = db.transaction(STORE_NAME, 'readwrite');

        let eventStore = transaction.objectStore(STORE_NAME);

        let request = eventStore.delete(trackingKey);

        request.onerror = () => {
          ewlogger.log('delete data failed - ', {
            trackingKey,
            error: request.error,
          });
        };

        request.onsuccess = () => {
          ewlogger.log('delete data succss', trackingKey);
        };
      }
    };
  }

  const WebStorageHanlder = new IDXWrapper();

  /** ----------------------------------------------------------------------------------
   *  Event Worker Code starts
   *  Function returns an object that exposes sendEvent Data that can be used to push
   *  taxonomy events to network.
   *
   *  this function takes care of adding data to index DB incase the network request fails
   * and also retry those events and delete from index db on further successful network request
   *
   */

  const EventWorkers = () => {
    let retryMap = {};

    let postUrl = '';

    function setPostUrl(url) {
      POST_URL = url;
    }

    /**
     * Private function
     * create a new xmlhttp request object
     *
     * @returns
     */
    function postData(data) {
      return fetch(POST_URL, {
        method: 'post',
        credentials: 'include',
        headers: {
          'Content-type': 'text/plain;charset=UTF-8',
        },
        body: data,
      });
    }

    let oldBatchInProgress = false;

    /**
     * Private function
     * Retry sending events stored in web storage
     *
     * @returns
     */
    function retryEventsFromStorage() {
      if (oldBatchInProgress) {
        return;
      }

      oldBatchInProgress = true;

      // get all data from db and retry each batch
      // if success -> delete the data from db
      // else update the retry count for the event
      WebStorageHanlder.getAllData()
        .then(data => {
          if (data.length > 0) {
            for (let i = 0; i < data.length; i++) {
              if (typeof data[i] === 'object' && data[i]['data']) {
                let event = data[i]['data'];
                let trackingKey = data[i]['trackingKey'];

                if (
                  retryMap[trackingKey] &&
                  retryMap[trackingKey] >= MAX_RETRY
                ) {
                  // if retry count has exceed max limit -> delete the data
                  WebStorageHanlder.delete(trackingKey);

                  // delete from retry map
                  delete retryMap[trackingKey];
                } else {
                  let dataToPost = event;

                  if (event && typeof event === 'object') {
                    try {
                      dataToPost = JSON.stringify(event);
                    } catch (e) {
                      return;
                    }
                  }

                  postData(dataToPost)
                    .then(function json(response) {
                      return response.status;
                    })
                    .then(function(status) {
                      // delete data from webstorage
                      WebStorageHanlder.delete(trackingKey);

                      // delete from retry map
                      delete retryMap[trackingKey];
                    })
                    .catch(function(error) {
                      // update retry count for this event
                      retryMap[trackingKey] = retryMap[trackingKey]
                        ? retryMap[trackingKey] + 1
                        : 1;
                    });
                }
              } else {
                console.error(
                  'retryEventsFromStorage >> invalid data in db',
                  data[i],
                );
              }
            }
          }
          oldBatchInProgress = false;
        })
        .catch(error => {
          console.error('OLD DATA ERROR::', error);
          oldBatchInProgress = false;
        });
    }

    /**
     * Public function to send tracking events to server
     * if success -> it'll initiate the retryEventsFromStorage function
     * else it'll add the event data to web storage
     *
     * @param {*} data
     */
    function sendEvent(event) {
      ewlogger.log('sendEvent::', event);
      let data = event;
      if (event && typeof event === 'object') {
        try {
          data = JSON.stringify(event);
        } catch (e) {
          return;
        }
      }

      postData(data)
        .then(function json(response) {
          ewlogger.log('postData::response', response);
          return response.status;
        })
        .then(function(status) {
          ewlogger.log('postData::sucess', status);
          // retry sending old events from web storage
          retryEventsFromStorage();
        })
        .catch(function(error) {
          ewlogger.log('postData::fail', error);
          // add the failed event to web storage
          WebStorageHanlder.add(event);
        });
    }

    return {
      sendEvent,
      setPostUrl,
    };
  };
  return EventWorkers;
})();
